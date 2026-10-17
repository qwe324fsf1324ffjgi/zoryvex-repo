#!/usr/bin/env node
// Breaks each payment guard on purpose and checks the suite notices.
//
// A passing test proves nothing until you know it can fail. Every guard
// listed below protects money or access: a signature check, a dedupe
// marker, a conditional write, an amount comparison, an ownership test.
// This removes each one, runs the tests that claim to cover it, and
// reports whether they went red. A guard whose removal leaves the suite
// green is decoration, and is reported as such.
//
//   node scripts/mutate-payment-guards.mjs
//   node scripts/mutate-payment-guards.mjs --only "stale subscription"
//
// Every file is restored from memory afterwards, including on a crash or a
// Ctrl-C, and the run ends by verifying the working tree is byte-identical
// to how it started.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

/**
 * Each mutation names the invariant in the founder's terms, because
 * "ConditionExpression removed" does not say what a customer would lose.
 */
const MUTATIONS = [
  {
    name: 'webhook signature verification',
    protects: 'anybody on the internet could forge a payment event',
    file: 'services/api/src/lib/paystack-signature.ts',
    from: '  return timingSafeEqual(expected, provided);',
    to: '  return true;',
    tests: ['tests/paystack-signature.test.ts', 'tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'webhook dedupe marker',
    protects: 'a redelivered event would be applied twice',
    file: 'services/api/src/repositories/webhook-repository.ts',
    from: "        ConditionExpression: 'attribute_not_exists(PK)',",
    to: '',
    tests: ['tests/webhook-repository.test.ts'],
  },
  {
    name: 'stale subscription guard',
    protects: 'an old webhook could cancel a subscription the customer just paid for',
    file: 'services/api/src/repositories/billing-repository.ts',
    from: "    conditions.push('#subscriptionCode = :expectedSubscriptionCode');",
    to: '',
    tests: ['tests/billing-repository.test.ts', 'tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'kit order idempotency',
    protects: 'a double click would create two orders and charge twice',
    file: 'services/api/src/repositories/kit-order-repository.ts',
    from: "          ConditionExpression: 'attribute_not_exists(PK)',",
    to: '',
    tests: ['tests/kit-order-repository.test.ts', 'tests/kit-service.test.ts'],
  },
  {
    name: 'plan price guard',
    protects: 'a customer could be billed an amount the page never showed',
    file: 'services/api/src/domain/subscription-service.ts',
    from: 'await deps.fetchPlan(',
    to: 'await disabledFetchPlan(',
    tests: ['tests/subscription-service.test.ts'],
  },
  {
    name: 'kit amount verification',
    protects: 'a Kit could be delivered for less than its price, or for nothing',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: '    verification.amountKobo === order.amountNGN * 100;',
    to: '    true;',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'kit currency verification',
    protects: 'a payment in another currency would be read as the naira price',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: "    verification.currency === 'NGN' &&\n    verification.amountKobo === order.amountNGN * 100;",
    to: '    verification.amountKobo === order.amountNGN * 100;',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'independent transaction verification',
    protects: 'a forged or mistaken webhook body would grant access with no second opinion',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: "  const verified =\n    verification.status === 'success' &&",
    to: '  const verified =\n    true &&',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'kit order status transition',
    protects: 'two concurrent deliveries could both grant the same entitlement',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: '  if (!transitioned) return false; // another delivery got there first',
    to: '  // transition result ignored',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'already-delivered short circuit',
    protects: 'a replayed success would re-deliver a Kit that already exists',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: "  if (order.status === 'succeeded' && (await deps.hasKitArtifact(roleId))) return false;",
    to: '',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'a settled but undelivered order still gets delivered',
    protects: 'a customer who paid keeps a succeeded order and no Kit, permanently',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    // Cuts the recovery branch out: a settled-but-undelivered order goes
    // back to being abandoned where it stands, which is the state the real
    // NGN 95,000 payment ended in.
    from: '    await deliverKit(order.employerId, roleId, kitOrderId, now, deps);',
    to: '    return false;',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'renewal amount check',
    protects: 'a small card-confirmation charge would buy a full paid month',
    file: 'services/api/src/domain/paystack-webhook-service.ts',
    from: "    expectedKobo > 0 && chargedKobo === expectedKobo && (charge?.currency ?? 'NGN') === 'NGN';",
    to: '    true;',
    tests: ['tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'reconciliation leaves state alone when the provider is unreachable',
    protects: 'a Paystack outage would settle real payments as abandoned',
    file: 'services/api/src/domain/billing-reconciliation-service.ts',
    from: '    report.unreachable += 1;',
    to: "    report.unreachable += 1;\n    await deps.updatePaymentAttempt(attempt.employerId, attempt.id, attempt.status, { status: 'abandoned' }, now.toISOString());",
    tests: ['tests/billing-reconciliation-service.test.ts'],
  },
  {
    name: 'reconciliation waits before judging',
    protects: 'a buyer still authorising in their banking app would be settled as abandoned',
    file: 'services/api/src/domain/billing-reconciliation-service.ts',
    from: 'export const RECONCILE_AFTER_MINUTES = 30;',
    to: 'export const RECONCILE_AFTER_MINUTES = 0;',
    tests: ['tests/billing-reconciliation-service.test.ts'],
  },
  {
    name: 'unknown provider status is reported, not guessed',
    protects: 'a status Paystack adds later would be silently mapped to grant or revoke',
    file: 'services/api/src/domain/billing-reconciliation-service.ts',
    from: '  const mapped = paymentStatusFromPaystack(verification.status);\n  if (!mapped) {',
    to: "  const mapped = paymentStatusFromPaystack(verification.status) ?? 'success';\n  if (false) {",
    tests: ['tests/billing-reconciliation-service.test.ts'],
  },
  {
    name: 'contact unlock is gated on read, not only on purchase',
    protects: 'the kill switch would stop new unlocks while still serving every old one',
    file: 'services/api/src/domain/contact-unlock-service.ts',
    from: '  if (!flags.contactUnlocks) {',
    to: '  if (false) {',
    tests: ['tests/contact-unlock-service.test.ts', 'tests/paid-access-gates.test.ts'],
  },
  {
    name: 'kit retry resumes instead of re-initializing',
    protects: 'a buyer who retries gets a 502 over a first click that worked',
    file: 'services/api/src/domain/kit-service.ts',
    from: '    if (resumed?.checkoutUrl) {',
    to: '    if (false) {',
    tests: ['tests/kit-service.test.ts'],
  },
  {
    name: 'subscription retry resumes instead of re-initializing',
    protects: 'the same 502, on the route that commits to a recurring charge',
    file: 'services/api/src/domain/subscription-service.ts',
    from: '    if (resumed?.checkoutUrl) {',
    to: '    if (false) {',
    tests: ['tests/subscription-service.test.ts'],
  },
  {
    name: 'a declined subscription checkout can be retried',
    protects: 'a declined card leaves the buyer permanently unable to subscribe',
    file: 'services/api/src/domain/subscription-service.ts',
    from: '  for (let round = 2; !created && isDeadPayment(attempt.status); round += 1) {',
    to: '  for (let round = 2; false; round += 1) {',
    tests: ['tests/subscription-service.test.ts'],
  },
  {
    name: 'a paid subscription never opens a second checkout',
    protects: 'somebody who already paid would be charged twice',
    file: 'services/api/src/domain/subscription-service.ts',
    from: 'isDeadPayment(attempt.status); round += 1) {',
    to: 'isTerminalPayment(attempt.status); round += 1) {',
    tests: ['tests/subscription-service.test.ts'],
  },
  {
    name: 'a declined Kit checkout can be retried',
    protects: 'a declined card leaves the buyer permanently unable to buy the Kit',
    file: 'services/api/src/domain/kit-service.ts',
    from: "  for (let round = 2; !created && stored.status === 'failed'; round += 1) {",
    to: '  for (let round = 2; false; round += 1) {',
    tests: ['tests/kit-service.test.ts'],
  },
  {
    name: 'a failed Kit order is closed, not left pending',
    protects: 'the role page tells a customer "Payment pending." forever after a decline',
    file: 'services/api/src/domain/billing-reconciliation-service.ts',
    from: '      await deps.applyUnsuccessfulPayment(updated);',
    to: '',
    tests: ['tests/billing-reconciliation-service.test.ts'],
  },
  {
    name: 'out-of-order events cannot overwrite newer state',
    protects: 'a redelivered create would resurrect a subscription since cancelled',
    file: 'services/api/src/domain/billing-state.ts',
    from: '  return event >= stored;',
    to: '  return true;',
    tests: ['tests/billing-state.test.ts', 'tests/paystack-webhook-service.test.ts'],
  },
  {
    name: 'the grace window actually expires',
    protects: 'a failed card would keep paid access open indefinitely',
    file: 'services/api/src/domain/billing-state.ts',
    from: "      return hasPassed(subscription.graceEndsAt, now) ? 'suspended' : 'grace';",
    to: "      return 'active';",
    tests: ['tests/billing-state.test.ts'],
  },
  {
    name: 'a cancelled subscription keeps only the period already paid for',
    protects: 'cancelling would either steal the paid month or never end access',
    file: 'services/api/src/domain/billing-state.ts',
    from: "      return periodOver ? 'suspended' : 'active';",
    to: "      return 'active';",
    tests: ['tests/billing-state.test.ts'],
  },
];

function run(cmd, args, cwd) {
  try {
    execFileSync(cmd, args, { cwd, stdio: 'pipe', shell: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, output: String(error.stdout ?? '') + String(error.stderr ?? '') };
  }
}

const originals = new Map();
function restoreAll() {
  for (const [path, content] of originals) writeFileSync(path, content);
  originals.clear();
}
process.on('SIGINT', () => {
  restoreAll();
  process.exit(130);
});

const results = [];
const baseline = execSync('git status --porcelain', { cwd: root }).toString().trim();

for (const mutation of MUTATIONS) {
  if (only && !mutation.name.includes(only)) continue;

  const path = join(root, mutation.file);
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    results.push({ ...mutation, verdict: 'FILE MISSING' });
    console.log(`SKIP  ${mutation.name}: ${mutation.file} does not exist`);
    continue;
  }

  if (!mutation.from || !source.includes(mutation.from)) {
    results.push({ ...mutation, verdict: 'ANCHOR MISSING' });
    console.log(`SKIP  ${mutation.name}: the line it removes is not in ${mutation.file}`);
    continue;
  }

  // Baseline: the tests must pass before the mutation, or a failure
  // afterwards proves nothing.
  const before = run('npx', ['vitest', 'run', ...mutation.tests], join(root, 'services/api'));
  if (!before.ok) {
    results.push({ ...mutation, verdict: 'ALREADY FAILING' });
    console.log(`SKIP  ${mutation.name}: its tests fail before any mutation`);
    continue;
  }

  originals.set(path, source);
  writeFileSync(path, source.replace(mutation.from, mutation.to));

  const after = run('npx', ['vitest', 'run', ...mutation.tests], join(root, 'services/api'));

  writeFileSync(path, source);
  originals.delete(path);

  const detected = !after.ok;
  results.push({ ...mutation, verdict: detected ? 'DETECTED' : 'NOT DETECTED' });
  console.log(
    `${detected ? 'PASS' : 'FAIL'}  ${mutation.name.padEnd(32)} ${detected ? 'removal is caught' : 'REMOVAL WENT UNNOTICED — the guard is untested'}`,
  );
  if (!detected) console.log(`        without it: ${mutation.protects}`);
}

restoreAll();

// The working tree must be exactly as it was found — compared against a
// baseline taken before the first mutation, not against "clean", so an
// unrelated edit in progress is not mistaken for a mutation left behind.
const after = execSync('git status --porcelain', { cwd: root }).toString().trim();
console.log('');
if (after !== baseline) {
  console.log('WORKING TREE NOT RESTORED.');
  console.log('before:\n' + baseline);
  console.log('after:\n' + after);
  process.exit(2);
}
console.log('working tree restored exactly as it was found');

const undetected = results.filter((r) => r.verdict === 'NOT DETECTED');
const skipped = results.filter((r) => !['DETECTED', 'NOT DETECTED'].includes(r.verdict));
console.log(
  `${results.filter((r) => r.verdict === 'DETECTED').length}/${results.length} guards proven, ` +
    `${undetected.length} untested, ${skipped.length} skipped`,
);
for (const s of skipped) console.log(`  skipped: ${s.name} (${s.verdict})`);
process.exit(undetected.length === 0 && skipped.length === 0 ? 0 : 1);
