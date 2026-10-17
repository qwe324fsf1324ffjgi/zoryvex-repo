#!/usr/bin/env node
// Creates a Paystack plan in TEST mode only. Refuses to run against a live
// secret key. Never reads, logs, or prints the key value itself.
const secretKey = process.env.PAYSTACK_TEST_SECRET_KEY;

if (!secretKey) {
  console.error(
    'PAYSTACK_TEST_SECRET_KEY is not set. This script only ever targets Paystack test mode; ' +
      'set a test-mode secret key (sk_test_...) as an environment variable to proceed.',
  );
  process.exit(1);
}

if (!secretKey.startsWith('sk_test_')) {
  console.error(
    'Refusing to run: PAYSTACK_TEST_SECRET_KEY does not look like a Paystack test-mode secret key ' +
      '(expected an sk_test_ prefix). This script must never run against a live key.',
  );
  process.exit(1);
}

const planName = process.argv[2];
if (!planName) {
  console.error('Usage: node scripts/paystack-test-plan.mjs "<plan name>"');
  process.exit(1);
}

const response = await fetch('https://api.paystack.co/plan', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: planName,
    amount: 0,
    interval: 'monthly',
    currency: 'NGN',
  }),
});

const result = await response.json();
if (!response.ok) {
  console.error(`Paystack test-plan creation failed: ${result.message ?? response.statusText}`);
  process.exit(1);
}

console.log(
  `Created Paystack test-mode plan "${planName}" (plan_code: ${result.data?.plan_code}).`,
);
