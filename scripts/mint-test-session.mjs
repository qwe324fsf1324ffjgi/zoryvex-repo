#!/usr/bin/env node
// Mints a real session in the TEST environment so a browser can be driven
// through authenticated flows.
//
// Why this exists
// ---------------
// Sign-in is a magic link delivered by email. That is the right design and
// it is deliberately not weakened here: there is no test-only bypass in the
// API, no header that skips authentication, no flag that turns the
// authorizer off. Nothing in this script runs inside the deployed system at
// all.
//
// Instead it does exactly what `issueSession` does — generate a session id,
// HMAC it with the environment's pepper, write the session and its
// per-account index row — and prints the cookie value. Every authorization
// check the API performs then runs unchanged against that session: the
// authorizer looks it up, checks idle and absolute expiry, and reads the
// role from the stored record.
//
// Why it cannot touch production
// ------------------------------
// Three independent reasons, not one:
//
//   1. It refuses any environment other than `test`, by name.
//   2. It reads the pepper from `/zoryvex/test/auth/token-pepper`. Production
//      has its own, and a session hashed with the wrong one is simply not
//      found.
//   3. It needs AWS credentials with write access to the test table. That is
//      a human's SSO session, not something the deployed app can obtain.
//
// The mechanism is the real one, so a test using it proves the real
// authorization model rather than a substitute for it.
//
//   node scripts/mint-test-session.mjs --role candidate --email someone@zoryvex.test

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

process.env.AWS_PROFILE = process.env.AWS_PROFILE ?? 'zoryvex-admin';
const REGION = process.env.AWS_REGION ?? 'eu-west-1';

const ENVIRONMENT = 'test';
const TABLE = `zoryvex-${ENVIRONMENT}-core`;
const PEPPER_PARAM = `/zoryvex/${ENVIRONMENT}/auth/token-pepper`;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const role = arg('role');
const email = (arg('email') ?? '').trim().toLowerCase();
const withVerifiedEvidence = process.argv.includes('--with-verified-evidence');
const asMagicLink = process.argv.includes('--magic-link');

if (!['candidate', 'employer_admin'].includes(role ?? '')) {
  console.error('Pass --role candidate|employer_admin');
  process.exit(1);
}
/**
 * Two reserved domains, both undeliverable, neither able to belong to a
 * real person — which is the property that matters: nothing here should
 * ever create a session for an address somebody might actually own.
 *
 * `@example.com` is here because Paystack's API rejects `.test` with
 * `"email" must be a valid email`, and an employer fixture that cannot
 * reach Paystack cannot exercise a checkout. `example.com` is reserved by
 * IANA (RFC 2606) for exactly this, accepts no mail, and satisfies an
 * email validator that insists on a real-looking TLD.
 */
/**
 * `@simulator.amazonses.com` is the third, and it is the only one a real
 * send may be pointed at.
 *
 * The other two accept no mail, so a notice addressed to one of them
 * bounces. SES measures bounce rate as a proportion and suspends an account
 * above five percent, and this account sends almost nothing, so a single
 * bounce is not a rounding error: it is most of the denominator. Testing a
 * notification by mailing `@example.com` would risk the account that sends
 * every sign-in link.
 *
 * AWS publishes the simulator for exactly this. `success@` is accepted and
 * discarded, counts as a delivery rather than a bounce, and never leaves
 * SES. Addresses to use: success@, bounce@, complaint@, suppressionlist@.
 */
const RESERVED_DOMAINS = ['@zoryvex.test', '@example.com', '@simulator.amazonses.com'];

if (!RESERVED_DOMAINS.some((domain) => email.endsWith(domain))) {
  console.error(
    `Pass --email <name>${RESERVED_DOMAINS.join(' or <name>')} (reserved domains only)`,
  );
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ssm = new SSMClient({ region: REGION });

/** The same pepper the test API hashes with. Never printed. */
async function readPepper() {
  const result = await ssm.send(
    new GetParameterCommand({ Name: PEPPER_PARAM, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value || value.includes('GENERATED-BY-SCRIPT')) {
    throw new Error(`${PEPPER_PARAM} is missing or still a placeholder.`);
  }
  return value;
}

const hmac = (pepper, value) => createHmac('sha256', pepper).update(value).digest('base64url');

/**
 * The account, created only if it is absent.
 *
 * Mirrors `createAccountIfNotExists`: candidate and employer accounts also
 * need their profile row, or the session points at an account the rest of
 * the product cannot read.
 */
async function ensureAccount() {
  const key = { PK: `ACCOUNT#${email}`, SK: 'PROFILE' };
  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (existing.Item) return existing.Item;

  const now = new Date().toISOString();
  const accountId = randomUUID();
  const subjectId = randomUUID();

  const account = {
    ...key,
    id: accountId,
    email,
    role,
    createdAt: now,
    ...(role === 'candidate' ? { candidateId: subjectId } : { employerId: subjectId }),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: account }));

  if (role === 'candidate') {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `CANDIDATE#${subjectId}`,
          SK: 'PROFILE',
          GSI3PK: 'ENTITY#CANDIDATE',
          GSI3SK: `CANDIDATE#${subjectId}`,
          // Discovery consent is structural, not a flag: matching finds
          // candidates by querying GSI1 for the track, and membership of
          // that index is what opting in actually means
          // (candidate-repository.ts setDiscoveryOptIn). Writing
          // `discoveryOptIn: true` without these two keys produced a
          // candidate the product itself can never create — the profile
          // said opted in, the index did not contain them, and matching
          // skipped them with nothing anywhere reporting a problem.
          GSI1PK: 'TRACK#aws_cloud',
          GSI1SK: `CANDIDATE#${subjectId}`,
          version: 1,
          id: subjectId,
          email,
          displayName: 'E2E Candidate',
          launchTrack: 'aws_cloud',
          discoveryOptIn: true,
          contactUnlockConsent: true,
          onboardingComplete: true,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  } else {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `EMPLOYER#${subjectId}`,
          SK: 'PROFILE',
          GSI3PK: 'ENTITY#EMPLOYER',
          GSI3SK: `EMPLOYER#${subjectId}`,
          id: subjectId,
          organizationName: 'E2E Employer',
          contactEmail: email,
          createdAt: now,
        },
      }),
    );

    // The entitlement row, which real employer creation writes in the same
    // transaction as the profile (employer-repository.ts
    // createEmployerWithEntitlement). Leaving it out produced an employer
    // the product itself can never create, and the difference was not
    // cosmetic: `updateEntitlement` is conditional on the row existing, so
    // a real NGN 95,000 Kit payment settled the order and then threw
    // ConditionalCheckFailedException on the way to granting anything.
    // That is how the delivery defect was found, but a fixture should not
    // be the thing that finds it.
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `EMPLOYER#${subjectId}`,
          SK: 'ENTITLEMENT',
          employerId: subjectId,
          plan: 'none',
          status: 'none',
          kitPurchasedAt: null,
          subscriptionRenewsAt: null,
        },
      }),
    );
  }

  return account;
}

/**
 * One verified evidence item for the test candidate.
 *
 * Matching skips a candidate with no verified evidence entirely, and it is
 * right to: the product matches on proof and a candidate with none has
 * nothing to match on. That means the shortlist, the interest routes and
 * mutual matching cannot be exercised at all against a freshly minted
 * candidate, which is how those paths stayed untested end to end.
 *
 * This writes a fixture, and says so in the record itself. The claim text
 * names it a fixture, `verificationRef` names this script, and the account
 * it hangs off is an `@zoryvex.test` address that cannot receive mail and
 * cannot belong to anybody. It exists only in the test table. Nothing here
 * runs against production, for the three reasons at the top of this file.
 */
async function ensureVerifiedEvidence(candidateId) {
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: 'EVIDENCE#e2e-fixture' },
    }),
  );
  if (existing.Item) return existing.Item.id;

  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `CANDIDATE#${candidateId}`,
        SK: 'EVIDENCE#e2e-fixture',
        version: 1,
        id: 'e2e-fixture',
        candidateId,
        source: 'project',
        claim: 'Test fixture: designed a multi-account AWS structure',
        context: 'Created by scripts/mint-test-session.mjs for end-to-end tests.',
        actions: 'Not a real claim by a real person. Test environment only.',
        outcome: 'Exists so matching has something to match on.',
        verificationState: 'verified',
        verificationMethod: 'repo_ownership',
        verifiedAt: now,
        verificationRef: 'mint-test-session.mjs fixture',
        visibility: 'discovery',
        consentGiven: true,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return 'e2e-fixture';
}

/**
 * A real sign-in link, for driving the product in a browser.
 *
 * The session cookie is `__Host-` and HttpOnly, so a browser cannot be
 * handed one from script — which is the point of it. Rather than weaken
 * that, this writes the same single-use AUTHTOKEN row the email flow
 * writes and returns the same URL the email would contain. The browser
 * then signs in through `/auth/callback` exactly as a person does: the
 * real consume endpoint, the real atomic single-use check, the real
 * session issuance, the real cookie.
 *
 * Nothing about authentication is bypassed or relaxed. The only thing
 * skipped is the email delivery, and the token still expires in ten
 * minutes and still cannot be used twice.
 */
async function mintMagicLink() {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hmac(pepper, token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 10 * 60_000);
  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `ACCOUNT#${email}`, SK: 'PROFILE' } }),
  );

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `AUTHTOKEN#${tokenHash}`,
        SK: 'AUTHTOKEN',
        email,
        intendedRole: role,
        existingAccountId: existing.Item?.id ?? null,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        consumed: false,
        ttl: Math.floor(expiresAt.getTime() / 1000) + 60,
      },
    }),
  );
  return `https://test.zoryvex.space/auth/callback#token=${token}`;
}

const pepper = await readPepper();
const account = await ensureAccount();

if (withVerifiedEvidence) {
  if (role !== 'candidate') {
    console.error('--with-verified-evidence only applies to a candidate');
    process.exit(1);
  }
  await ensureVerifiedEvidence(account.candidateId);
}

// Exactly what issueSession does.
const sessionId = randomBytes(32).toString('base64url');
const csrfToken = randomBytes(32).toString('base64url');
const sessionIdHash = hmac(pepper, sessionId);

const now = new Date();
// Candidate and employer_admin both carry the long lifetime in
// SESSION_LIFETIMES; a short one here would make a test fail as a clock
// artefact rather than as a defect.
const idleExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
const absoluteExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

const record = {
  sessionIdHash,
  accountId: account.id,
  accountEmail: email,
  role: account.role,
  ...(account.candidateId ? { candidateId: account.candidateId } : {}),
  ...(account.employerId ? { employerId: account.employerId } : {}),
  csrfTokenHash: hmac(pepper, csrfToken),
  issuedAt: now.toISOString(),
  idleExpiresAt: idleExpiresAt.toISOString(),
  absoluteExpiresAt: absoluteExpiresAt.toISOString(),
};

const ttl = Math.floor(absoluteExpiresAt.getTime() / 1000) + 60;

await ddb.send(
  new PutCommand({
    TableName: TABLE,
    Item: { PK: `SESSION#${sessionIdHash}`, SK: 'SESSION', ...record, ttl },
  }),
);
await ddb.send(
  new PutCommand({
    TableName: TABLE,
    Item: { PK: `ACCOUNT#${email}`, SK: `SESSION#${sessionIdHash}`, sessionIdHash, ttl },
  }),
);

// The session id and CSRF token are what a browser would hold. Printed
// because a test has to set them; the pepper they are hashed with is not,
// and neither is anything from another environment.
console.log(
  JSON.stringify(
    {
      environment: ENVIRONMENT,
      email,
      role: account.role,
      candidateId: account.candidateId ?? null,
      employerId: account.employerId ?? null,
      ...(asMagicLink ? { magicLinkUrl: await mintMagicLink() } : {}),
      sessionCookieName: '__Host-zoryvex_session',
      sessionId,
      csrfToken,
      expiresAt: absoluteExpiresAt.toISOString(),
    },
    null,
    2,
  ),
);
