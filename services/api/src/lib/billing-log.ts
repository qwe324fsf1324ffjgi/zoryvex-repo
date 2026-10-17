/**
 * Structured logging for the billing paths, with redaction that is not
 * optional.
 *
 * Billing is the one part of this system where the thing you most want in
 * a log is the thing you are least allowed to write: the secret key that
 * signs webhooks and authorizes every API call, the `authorization_code`
 * that can charge a customer's card again, and the `email_token` that can
 * cancel their subscription. CLAUDE.md's rule is absolute — never print,
 * log, commit or send a secret — so redaction happens here, at the only
 * place billing code is expected to log from, rather than being a habit
 * each call site has to remember.
 *
 * One JSON object per line, because CloudWatch Logs Insights can query
 * that and cannot usefully query prose.
 */

/**
 * Keys whose values never appear in a log line, matched case-insensitively
 * on the whole key.
 *
 * Deliberately a denylist of exact names rather than a substring search:
 * `authorization` must be redacted, but so must a field called `token`,
 * and a substring rule broad enough to catch both would also redact
 * `email_token_required` style flags and quietly hide the shape of the
 * payload from whoever is debugging.
 */
const REDACTED_KEYS = new Set([
  'authorization',
  'authorization_code',
  'authorizationcode',
  'secretkey',
  'secret_key',
  'secret',
  'email_token',
  'emailtoken',
  'token',
  'password',
  'pin',
  'cvv',
  'card_number',
  'pan',
  'account_number',
  'bvn',
  'signature',
  'x-paystack-signature',
]);

/**
 * A Paystack live or test key, anywhere inside a string.
 *
 * The key can reach a log through a path no key-name rule covers — an
 * error message that quotes the request, a stack frame with a URL in it —
 * so the string scrub runs over every value regardless of its key.
 */
const KEY_PATTERN = /\b(sk|pk)_(test|live)_[A-Za-z0-9]+/g;

function scrubString(value: string): string {
  return value.replace(KEY_PATTERN, (match) => `${match.slice(0, 7)}REDACTED`);
}

/**
 * Recursively redact a value for logging.
 *
 * Depth-limited because the object being logged is often a Paystack
 * payload, which is attacker-influenced input: a deeply nested body should
 * cost a truncated log line, never a stack overflow inside the logger of
 * the handler that was trying to report a problem.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth limit]';
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactForLog(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactForLog(inner, depth + 1);
  }
  return out;
}

export interface BillingLogFields {
  /** Ties every line for one payment together, across Lambdas and minutes. */
  correlationId?: string | undefined;
  employerId?: string | undefined;
  reference?: string | undefined;
  event?: string | undefined;
  [key: string]: unknown;
}

function emit(level: 'info' | 'warn' | 'error', message: string, fields: BillingLogFields): void {
  const line = JSON.stringify({
    level,
    component: 'billing',
    message,
    ...(redactForLog(fields) as Record<string, unknown>),
    at: new Date().toISOString(),
  });
  // Written to the streams directly rather than through `console`.
  // CloudWatch captures both, `console.log` is disallowed by this repo's
  // lint rules, and routing a routine info line through `console.warn` to
  // get around that would make every successful payment look like a
  // problem in the logs.
  const stream = level === 'info' ? process.stdout : process.stderr;
  stream.write(`${line}\n`);
}

export const billingLog = {
  info: (message: string, fields: BillingLogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: BillingLogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: BillingLogFields = {}) => emit('error', message, fields),
};

/**
 * What an employer is allowed to be told about a payment failure.
 *
 * Paystack's `gateway_response` is written for a merchant, not a customer:
 * it carries bank names, processor codes and occasionally the last four
 * digits of a card, and repeating it to whoever is holding the session is
 * an information leak dressed up as helpfulness. The list below is the set
 * of outcomes a customer can actually act on, and everything else becomes
 * the same neutral sentence.
 */
export function safeFailureMessage(gatewayResponse: string | null | undefined): string {
  const raw = (gatewayResponse ?? '').trim().toLowerCase();
  if (raw.includes('insufficient')) {
    return 'Your bank declined the payment for insufficient funds. Try another card.';
  }
  if (raw.includes('expired')) {
    return 'That card has expired. Add a current one and we will try again.';
  }
  if (raw.includes('declin')) {
    return 'Your bank declined the payment. They can tell you why; we are not told.';
  }
  if (raw.includes('incorrect') || raw.includes('invalid')) {
    return 'Some of the card details were not accepted. Check them and try again.';
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return 'The payment timed out before your bank answered. Nothing was charged.';
  }
  return 'The payment did not go through. Nothing was charged. Try again, or use another card.';
}
