#!/usr/bin/env node
// Creates the founder/admin account row, which is the one account this
// product will never create for itself.
//
// docs/DATA_MODEL.md and ADR 0001: there is no self-serve admin sign-up. An
// unrecognised email is refused identically to a wrong code, so an admin
// account has to exist before anybody can sign into one. Nothing in the
// application writes it — `createAccountIfNotExists` is typed to accept only
// candidate and employer_admin — and until now nothing outside the
// application wrote it either, so founder/admin sign-in could not work on a
// real environment at all.
//
// Safe to re-run. It refuses to change an account that already exists,
// including one that exists with the wrong role, because silently promoting
// an ordinary employer account to founder_admin is the one mistake here that
// would matter.
//
//   node scripts/provision-founder-admin.mjs --env production --email you@example.com

import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

process.env.AWS_PROFILE = process.env.AWS_PROFILE ?? 'zoryvex-admin';
const REGION = process.env.AWS_REGION ?? 'eu-west-1';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const env = arg('env');
const emailRaw = arg('email');

if (!env || !['test', 'production'].includes(env)) {
  console.error('Pass --env test|production');
  process.exit(1);
}
if (!emailRaw || !emailRaw.includes('@')) {
  console.error('Pass --email <the founder address that will sign in>');
  process.exit(1);
}

const email = emailRaw.trim().toLowerCase();
const table = `zoryvex-${env}-core`;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const Key = { PK: `ACCOUNT#${email}`, SK: 'PROFILE' };

const existing = await ddb.send(new GetCommand({ TableName: table, Key }));

if (existing.Item) {
  const role = existing.Item.role;
  if (role === 'founder_admin') {
    console.log(`Already provisioned: ${email} is founder_admin in ${env}. Nothing changed.`);
    process.exit(0);
  }
  console.error(
    `Refusing to change an existing account. ${email} exists in ${env} with role "${role}".\n` +
      'Promoting a real account to founder_admin is not something this should do quietly.\n' +
      'Use a different address, or delete that account deliberately first.',
  );
  process.exit(1);
}

const item = {
  ...Key,
  id: randomUUID(),
  email,
  role: 'founder_admin',
  createdAt: new Date().toISOString(),
};

await ddb.send(
  new PutCommand({
    TableName: table,
    Item: item,
    // Nothing may have appeared between the read and the write.
    ConditionExpression: 'attribute_not_exists(PK)',
  }),
);

console.log(`Provisioned ${email} as founder_admin in ${env} (account ${item.id}).`);
console.log('Sign in at /admin/sign-in with that address; the link arrives by email as usual.');
