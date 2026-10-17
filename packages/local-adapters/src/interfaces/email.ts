export interface SentEmail {
  id: string;
  to: string;
  subject: string;
  bodyPreview: string;
  sentAt: string;
}

/**
 * Never sends real email. The local implementation records what would
 * have been sent, visible only in the founder/admin view — this is what
 * lets the auth flow and notification paths be proven end-to-end before
 * SES exists.
 */
export interface EmailAdapter {
  send(to: string, subject: string, bodyPreview: string): SentEmail;
  listSent(): SentEmail[];
}
