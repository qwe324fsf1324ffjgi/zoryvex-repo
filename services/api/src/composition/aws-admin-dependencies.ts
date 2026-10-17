import { listRecentAuditEvents } from '../repositories/audit-event-repository';
import type { AdminDependencies } from '../domain/admin-service';

export function createAwsAdminDependencies(): AdminDependencies {
  return { listRecentAuditEvents };
}
