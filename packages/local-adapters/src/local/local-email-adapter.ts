import type { EmailAdapter, SentEmail } from '../interfaces/email';
import { getJSON, setJSON } from './storage';

const KEY = 'EMAIL#SENT_LOG';

export class LocalEmailAdapter implements EmailAdapter {
  send(to: string, subject: string, bodyPreview: string): SentEmail {
    const email: SentEmail = {
      id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      to,
      subject,
      bodyPreview,
      sentAt: new Date().toISOString(),
    };
    const log = getJSON<SentEmail[]>(KEY) ?? [];
    log.push(email);
    setJSON(KEY, log);
    return email;
  }

  listSent(): SentEmail[] {
    return getJSON<SentEmail[]>(KEY) ?? [];
  }
}
