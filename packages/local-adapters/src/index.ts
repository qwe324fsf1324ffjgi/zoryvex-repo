export type { AccountRole, AuthAccount, AuthAdapter, Session } from './interfaces/auth';
export type { DataAdapter } from './interfaces/data';
export type { EmailAdapter, SentEmail } from './interfaces/email';
export {
  type FileAdapter,
  type FileUploadResult,
  type UploadedFile,
  MAX_EVIDENCE_FILE_BYTES,
  ALLOWED_EVIDENCE_MIME_TYPES,
} from './interfaces/files';
export type { Job, JobStatus, QueueAdapter } from './interfaces/queue';
export type { AIAdapter, MatchSuggestion } from './interfaces/ai';
export type {
  Checkout,
  CheckoutKind,
  CheckoutStatus,
  PaymentsAdapter,
} from './interfaces/payments';

export { LocalDataAdapter } from './local/local-data-adapter';
export { LocalAuthAdapter } from './local/local-auth-adapter';
export { LocalEmailAdapter } from './local/local-email-adapter';
export { LocalFileAdapter } from './local/local-file-adapter';
export { LocalQueueAdapter } from './local/local-queue-adapter';
export { LocalAIAdapter } from './local/local-ai-adapter';
export { LocalPaymentsAdapter } from './local/local-payments-adapter';
export { store, getJSON, setJSON } from './local/storage';

export * from './fixtures/index';

import { LocalAIAdapter } from './local/local-ai-adapter';
import { LocalAuthAdapter } from './local/local-auth-adapter';
import { LocalDataAdapter } from './local/local-data-adapter';
import { LocalEmailAdapter } from './local/local-email-adapter';
import { LocalFileAdapter } from './local/local-file-adapter';
import { LocalPaymentsAdapter } from './local/local-payments-adapter';
import { LocalQueueAdapter } from './local/local-queue-adapter';
import { AUTH_ACCOUNTS, seedIfNeeded } from './fixtures/index';

export interface LocalAdapters {
  data: LocalDataAdapter;
  auth: LocalAuthAdapter;
  email: LocalEmailAdapter;
  files: LocalFileAdapter;
  queue: LocalQueueAdapter;
  ai: LocalAIAdapter;
  payments: LocalPaymentsAdapter;
}

let cached: LocalAdapters | null = null;

/** Wires every local adapter together and seeds fixture data once. Safe to call repeatedly. */
export function getLocalAdapters(): LocalAdapters {
  if (cached) return cached;

  const data = new LocalDataAdapter();
  const email = new LocalEmailAdapter();
  const auth = new LocalAuthAdapter(AUTH_ACCOUNTS, email, data);
  const files = new LocalFileAdapter();
  const queue = new LocalQueueAdapter();
  const ai = new LocalAIAdapter();
  const payments = new LocalPaymentsAdapter(data);

  seedIfNeeded(data);

  cached = { data, auth, email, files, queue, ai, payments };
  return cached;
}
