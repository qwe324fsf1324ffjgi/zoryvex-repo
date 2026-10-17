#!/usr/bin/env node
// Proves docs/PRODUCT_SPEC.md's settlement table still describes the prices
// the product actually charges.
//
// The table tells the founder what lands in the bank per sale. Every figure
// in it is derived from a price, and the prices are declared in code. When
// the founder raised prices on 2026-08-30 the table was recomputed by hand
// and happened to be right; nothing would have said so if it had not been,
// and nothing would say so next time. A settlement figure that is quietly
// wrong looks exactly like one that is correct.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPrices } from './lib/live-prices.mjs';
import {
  STARTER_LIFETIME_COLLECTION_NGN,
  chargesBeforeLimit,
  settlementRow,
} from './lib/paystack-fees.mjs';

const root = join(import.meta.dirname, '..');
const specPath = join(root, 'docs/PRODUCT_SPEC.md');

const prices = extractPrices(
  readFileSync(join(root, 'apps/web/src/lib/pricing.ts'), 'utf8') +
    readFileSync(join(root, 'packages/contracts/src/domain.ts'), 'utf8'),
);
const spec = readFileSync(specPath, 'utf8');

const ngn = (n) => `NGN ${n.toLocaleString('en-NG')}`;

/** Parse the "Customer pays" column back to a number. */
function parseNGN(cell) {
  const digits = cell.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

const rows = new Map();
const headroom = new Map();
const HEADROOM_HEADING = '### Charges that fit inside the Starter Business limit';
let inHeadroom = false;
for (const line of spec.split('\n')) {
  if (line.startsWith('#')) inHeadroom = line.trim() === HEADROOM_HEADING;
  if (!line.startsWith('|')) continue;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  const amount = parseNGN(cells[1] ?? '');
  if (!amount) continue;
  if (cells.length === 6) rows.set(amount, { sku: cells[0], cells });
  // The headroom table is three columns: SKU, price, charges before the limit.
  if (inHeadroom && cells.length === 3) {
    headroom.set(amount, { sku: cells[0], charges: cells[2] ?? '' });
  }
}

const failures = [];

for (const price of prices) {
  const row = rows.get(price);
  if (!row) {
    failures.push(
      `${ngn(price)} is charged but has no settlement row. Every live price needs one, ` +
        `or the founder is reading a table that does not cover what is being sold.`,
    );
    continue;
  }
  const expected = settlementRow(price);
  const [, , localFee, localSettlement, intlFee, intlSettlement] = row.cells;

  const check = (label, actual, want) => {
    // The local-fee cell carries a "(capped)" note when the 1.5% + 100
    // formula exceeds NGN 2,000. Compare the number, keep the note.
    const actualNumber = parseNGN(actual);
    if (actualNumber !== want) {
      failures.push(
        `${row.sku} (${ngn(price)}): ${label} says ${actual}, computes to ${ngn(want)}`,
      );
    }
  };

  check('local fee', localFee ?? '', expected.localFee);
  check('local settlement', localSettlement ?? '', expected.localSettlement);
  check('international fee', intlFee ?? '', expected.intlFee);
  check('international settlement', intlSettlement ?? '', expected.intlSettlement);

  const saysCapped = /capped/i.test(localFee ?? '');
  if (saysCapped !== expected.localCapped) {
    failures.push(
      `${row.sku} (${ngn(price)}): local fee ${expected.localCapped ? 'is' : 'is not'} on the ` +
        `NGN 2,000 cap, but the table ${saysCapped ? 'says it is' : 'does not say so'}`,
    );
  }
}

// The headroom table says how many charges of each SKU fit inside Paystack's
// Starter Business lifetime limit. It is the figure a price raise changes
// silently: raising standard Partner to NGN 5,000,000 took its row from 5 to
// 1, which is the difference between a subscription that renews and one that
// cannot. Nothing on the page looks different when that number goes stale.
for (const price of prices) {
  const row = headroom.get(price);
  if (!row) {
    failures.push(
      `${ngn(price)} is charged but has no headroom row. Every live price needs one, ` +
        `or the founder cannot see what it does to the Starter Business limit.`,
    );
    continue;
  }
  const want = chargesBeforeLimit(price);
  if (Number(row.charges) !== want) {
    failures.push(
      `${row.sku} (${ngn(price)}): headroom says ${row.charges} charges, ` +
        `computes to ${want} against the ${ngn(STARTER_LIFETIME_COLLECTION_NGN)} limit`,
    );
  }
}

for (const [amount, row] of headroom) {
  if (!prices.includes(amount)) {
    failures.push(
      `${row.sku} has a headroom row at ${ngn(amount)}, which is not a price the product charges.`,
    );
  }
}

for (const [amount, row] of rows) {
  if (!prices.includes(amount)) {
    failures.push(
      `${row.sku} lists ${ngn(amount)}, which is not a price the product charges. ` +
        `Either the price changed and this row did not, or the row is for a SKU that no longer exists.`,
    );
  }
}

if (failures.length > 0) {
  console.error('Settlement table check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nRecompute from scripts/lib/paystack-fees.mjs rather than editing the numbers by hand.',
  );
  process.exit(1);
}

console.log(
  `Settlement table check passed: ${prices.length} live prices, ` +
    `${rows.size} settlement rows, ${headroom.size} headroom rows, ` +
    `every fee, settlement and charge-count figure recomputed.`,
);
