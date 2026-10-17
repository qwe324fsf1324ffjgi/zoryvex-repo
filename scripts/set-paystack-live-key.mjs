#!/usr/bin/env node
// Stores the Paystack live secret key in Parameter Store, without the key
// ever being visible to anybody but the person typing it.
//
// This exists because every other way of getting a secret into AWS leaks it
// somewhere:
//
//   - passing it as a command argument puts it in shell history, and in the
//     process list where any other process on the machine can read it;
//   - putting it in an environment variable hands it to every child process;
//   - pasting it into a chat window writes it into a transcript for good;
//   - the AWS Console works, but it is six clicks and a region dropdown, and
//     the wrong region writes a parameter that nothing reads.
//
// Here the key is typed at a prompt with the terminal echo turned off, held
// in memory, sent to AWS through the SDK (so it never appears in argv), and
// dropped. It is never written to disk, never logged, and never printed —
// not even masked, since a length is a clue.
//
// Run it yourself, in your own terminal:
//
//   node scripts/set-paystack-live-key.mjs
//   node scripts/set-paystack-live-key.mjs --env test
//
// It verifies the key against Paystack before storing it, so a mistyped or
// revoked key fails here rather than at a customer's checkout.
//
// The `--env test` form writes the test parameter and demands an sk_test_
// key, with the two prefix checks swapped so neither key can be stored in
// the other environment. It is needed because Paystack's "Generate new
// secret key" rotates the account's secret key rather than only the live
// one. The live key was rotated on 2026-09-11 after appearing in a
// screenshot; the test key here was left at its 2026-08-18 value, and
// Paystack answered 401 "Invalid key" to every test-mode call afterwards.
// That breaks test-mode payments in both directions: outgoing calls are
// rejected, and a genuine Paystack webhook signed with the current key
// fails our signature check.

import { createInterface } from 'node:readline';
import { SSMClient, PutParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';

const environment = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : 'production';

if (environment !== 'production' && environment !== 'test') {
  console.error('--env must be production or test.');
  process.exit(1);
}

const live = environment === 'production';
const expectedPrefix = live ? 'sk_live_' : 'sk_test_';
const wrongPrefix = live ? 'sk_test_' : 'sk_live_';
const PARAMETER = `/zoryvex/${environment}/paystack/secret-key`;
const REGION = process.env.AWS_REGION ?? 'eu-west-1';

// This project has no default AWS profile on purpose: a stray static key was
// once found under [default] and removed, so a command without a profile
// correctly finds no credentials rather than silently acting as somebody
// else. Every other script here defaults it; this one did not, and the SDK
// failed with "Could not load credentials from any providers" after the key
// had already been typed and verified.
process.env.AWS_PROFILE = process.env.AWS_PROFILE ?? 'zoryvex-admin';

/** Reads a line with the terminal's echo suppressed, so nothing is displayed. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'This needs an interactive terminal, so the key can be typed without being echoed.\n' +
            'Run it directly in your own terminal rather than through another tool.',
        ),
      );
      return;
    }

    process.stdout.write(question);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    // readline echoes by default; muting the output stream is what keeps the
    // key off the screen, out of any scrollback, and out of a screenshot.
    let muted = false;
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => (muted ? true : realWrite(chunk, ...rest));
    muted = true;

    rl.question('', (answer) => {
      muted = false;
      process.stdout.write = realWrite;
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Confirms the key actually works before it is stored anywhere. */
async function verifyAgainstPaystack(key) {
  const response = await fetch('https://api.paystack.co/plan?perPage=1', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (response.status === 401) return { ok: false, why: 'Paystack rejected it (401 unauthorized)' };
  if (!response.ok) return { ok: false, why: `Paystack returned ${response.status}` };
  const body = await response.json().catch(() => null);
  if (!body?.status) return { ok: false, why: 'Paystack returned an unexpected response' };
  return { ok: true };
}

// Said before the prompt, not inside it, because the prompt line is the
// last thing drawn before the terminal goes silent.
//
// The echo is off, so pasting shows nothing at all: no asterisks, no
// cursor movement, no wrapping. That is indistinguishable from a frozen
// terminal, and the first person to use this reported exactly that —
// "I have pasted and nothing is happening". The key was fine; the screen
// was supposed to look like that. Saying so costs three lines.
console.log(`Storing the Paystack ${live ? 'LIVE' : 'TEST'} secret key in ${PARAMETER}.`);
console.log('');
console.log('  Nothing will appear on screen while you paste. That is deliberate:');
console.log('  the input is hidden so the key cannot reach your scrollback.');
console.log('  Paste it, then press Enter.');
console.log('');

const key = await promptHidden(`Key (hidden), then Enter: `);

if (!key) {
  console.error('Nothing entered. Nothing was changed.');
  process.exit(1);
}

if (key.startsWith(wrongPrefix)) {
  console.error(
    live
      ? 'That is a TEST key (sk_test_). This parameter is read by production, where a test key\n' +
          'makes every real checkout fail. Nothing was changed.'
      : 'That is a LIVE key (sk_live_). This parameter is read by the test environment, where a\n' +
          'live key would move real money on what is supposed to be a test checkout.\n' +
          'Nothing was changed.',
  );
  process.exit(1);
}

if (!key.startsWith(expectedPrefix)) {
  console.error(
    `That does not look like a Paystack secret key: they start with ${expectedPrefix}.\n` +
      'You may have pasted the PUBLIC key (pk_…), which cannot authorise server requests.\n' +
      'Nothing was changed.',
  );
  process.exit(1);
}

console.log('Checking the key against Paystack before storing it...');
const check = await verifyAgainstPaystack(key);
if (!check.ok) {
  console.error(`That key did not work: ${check.why}. Nothing was changed.`);
  process.exit(1);
}
console.log('  the key authenticates.');

// Already the stored one? Then say so and stop.
//
// Writing an identical value would make a new parameter version for no
// reason, and more importantly it would leave the founder unsure whether
// anything had actually been wrong. "Nothing needed changing" is a more
// useful answer than a silent success, and it is the answer most of the
// time somebody re-enters a key to be safe.
const ssmForCompare = new SSMClient({ region: REGION });
let storedNow = null;
try {
  storedNow = (
    await ssmForCompare.send(new GetParameterCommand({ Name: PARAMETER, WithDecryption: true }))
  ).Parameter;
} catch {
  // No parameter yet, or no read access. Either way, fall through and write.
}

if (storedNow?.Value === key) {
  console.log('');
  console.log(
    `Nothing to change: ${PARAMETER} already holds this exact key (version ${storedNow.Version}).`,
  );
  console.log('Stored on ' + String(storedNow.LastModifiedDate).slice(0, 24) + '.');
  console.log('');
  console.log('Clear it from your clipboard; it was never needed.');
  process.exit(0);
}

if (storedNow) {
  console.log('');
  console.log(`This differs from the stored key (version ${storedNow.Version}). Replacing it.`);
}

const ssm = new SSMClient({ region: REGION });
let result;
try {
  result = await ssm.send(
    new PutParameterCommand({
      Name: PARAMETER,
      Value: key,
      Type: 'SecureString',
      Overwrite: true,
    }),
  );
} catch (error) {
  // Almost always an expired or absent SSO session. Say so, rather than
  // leaving a wall of SDK stack trace after the key has already been typed.
  const expired = /credential|token|expired|sso/i.test(String(error));
  console.error(
    expired
      ? `
AWS would not accept the request: ${error.name ?? 'credentials unavailable'}.
` +
          `Sign in with:  aws sso login --profile ${process.env.AWS_PROFILE}
` +
          'then run this again. Nothing was stored, and the key was not kept.'
      : `
Storing the key failed: ${error.message}
Nothing was stored.`,
  );
  process.exit(1);
}

console.log(`\nStored in ${PARAMETER} (now version ${result.Version}), region ${REGION}.`);
console.log(
  'The value was never printed, never written to disk, and is not in your shell history.',
);
console.log(
  live
    ? '\nNext: node scripts/go-live-payments.mjs --confirm GO-LIVE'
    : '\nNext: npm run plans:check test, which compares contracts, the parameter and Paystack.',
);
