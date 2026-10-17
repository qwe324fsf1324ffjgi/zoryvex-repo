import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The sixth pair for ADR 0004's step one, on auditability.
 *
 * Both tasks refuse the same wrong answer: an audit pipeline that is on,
 * healthy, delivering, and missing the half that matters.
 *
 * On Azure a diagnostic setting with only a `metric` block is valid and
 * produces charts and no entries. Somebody investigating who read a
 * credential gets a graph of how many times it was read.
 *
 * On GCP the split is starker and is the most consequential default anywhere
 * in this task set. Admin Activity logging is always on and records changes.
 * Data Access records reads, is off by default for every service except
 * BigQuery, and cannot be turned on retroactively. The pipeline looks
 * complete and answers every question except the one asked after a leak, and
 * the missing months can never be recovered, because the entries were never
 * generated rather than generated and deleted.
 */

const AZURE_ID = 'task_audit_trail_exists_azure_v1';
const GCP_ID = 'task_audit_records_reads_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_audit', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_audit', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_log_analytics_workspace" "audit" {
  name                = "audit-workspace"
  resource_group_name = "rg-security"
  location            = "westeurope"
  retention_in_days   = 365
}

resource "azurerm_monitor_diagnostic_setting" "vault" {
  name                       = "${azureParams.token}"
  target_resource_id         = azurerm_key_vault.prod.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.audit.id

  enabled_log {
    category = "AuditEvent"
  }

  metric {
    category = "AllMetrics"
  }
}
`;

const GCP_PASSING = `
resource "google_project_iam_audit_config" "storage" {
  project = "customer-data"
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_logging_project_sink" "audit" {
  name        = "${gcpParams.token}"
  destination = "storage.googleapis.com/security-archive-bucket"
  filter      = "logName:cloudaudit.googleapis.com"

  unique_writer_identity = true
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure audit trail exists', () => {
  it('is registered with a real pass mark', () => {
    const task = taskById(AZURE_ID);
    expect(task).toBeDefined();
    expect(task!.passMark).toBe(task!.checks.length - 1);
    expect(task!.passMark).toBeGreaterThan(0);
  });

  it('passes a correct answer', () => {
    const task = taskById(AZURE_ID)!;
    const result = gradeSubmission(task, AZURE_PASSING, azureParams);
    expect(result.identityOk).toBe(true);
    expect(
      result.passed,
      `failed: ${failed(AZURE_ID, AZURE_PASSING, azureParams).join(', ')}`,
    ).toBe(true);
  });

  /**
   * The one the task exists for. Metrics are configured, the setting deploys,
   * the portal shows it as on, and it contains no record of any access.
   */
  it('fails a metrics-only diagnostic setting', () => {
    const source = AZURE_PASSING.replace(/enabled_log \{[\s\S]*?\n {2}\}/, '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('logs_not_only_metrics');
  });

  it('accepts the older log block spelling', () => {
    const source = AZURE_PASSING.replace('enabled_log {', 'log {');
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('logs_not_only_metrics');
  });

  it('fails a setting with nowhere to send records', () => {
    const source = AZURE_PASSING.replace(
      'log_analytics_workspace_id = azurerm_log_analytics_workspace.audit.id',
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('somewhere_to_send_it');
  });

  it('fails retention left at the ninety-day default', () => {
    const source = AZURE_PASSING.replace('retention_in_days   = 365', 'retention_in_days   = 90');
    expect(failed(AZURE_ID, source, azureParams)).toContain('kept_longer_than_the_default');
  });

  it('fails an audit trail stored inside the vault it audits', () => {
    // The record of tampering must not be reachable by whoever tampered.
    const source = AZURE_PASSING.replace(
      'log_analytics_workspace_id = azurerm_log_analytics_workspace.audit.id',
      'storage_account_id = azurerm_key_vault.prod.id',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('not_reading_its_own_destination');
  });

  it('refuses a submission written against somebody else’s brief', () => {
    const task = taskById(AZURE_ID)!;
    const result = gradeSubmission(task, AZURE_PASSING, deriveTaskParams('someone_else', AZURE_ID));
    expect(result.identityOk).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails an empty submission', () => {
    expect(gradeSubmission(taskById(AZURE_ID)!, '', azureParams).passed).toBe(false);
  });
});

describe('GCP audit records reads', () => {
  it('is registered with a real pass mark', () => {
    const task = taskById(GCP_ID);
    expect(task).toBeDefined();
    expect(task!.passMark).toBe(task!.checks.length - 1);
    expect(task!.passMark).toBeGreaterThan(0);
  });

  it('passes a correct answer', () => {
    const task = taskById(GCP_ID)!;
    const result = gradeSubmission(task, GCP_PASSING, gcpParams);
    expect(result.identityOk).toBe(true);
    expect(result.passed, `failed: ${failed(GCP_ID, GCP_PASSING, gcpParams).join(', ')}`).toBe(
      true,
    );
  });

  /**
   * The default that cannot be undone after the fact. Everything else in the
   * submission is a working audit pipeline.
   */
  it('fails a sink with no Data Access logging behind it', () => {
    const source = GCP_PASSING.replace(
      /resource "google_project_iam_audit_config" "storage" \{[\s\S]*?\n\}/,
      '',
    );
    const ids = failed(GCP_ID, source, gcpParams);
    expect(ids).toContain('data_access_logging_enabled');
    expect(ids).toContain('reads_specifically');
  });

  it('fails DATA_WRITE alone, which Admin Activity largely covers already', () => {
    const source = GCP_PASSING.replace(
      `  audit_log_config {
    log_type = "DATA_READ"
  }

`,
      '',
    );
    const ids = failed(GCP_ID, source, gcpParams);
    expect(ids).toContain('reads_specifically');
    // The config itself is still present and switched on, so only the
    // narrower check should fail. Both failing would mean the two checks are
    // really one.
    expect(ids).not.toContain('data_access_logging_enabled');
  });

  it('accepts allServices as covering storage', () => {
    const source = GCP_PASSING.replace(
      'service = "storage.googleapis.com"',
      'service = "allServices"',
    );
    expect(failed(GCP_ID, source, gcpParams)).not.toContain('covers_the_storage_service');
  });

  it('fails a config that switches reads on for the wrong service', () => {
    const source = GCP_PASSING.replace(
      'service = "storage.googleapis.com"',
      'service = "bigquery.googleapis.com"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('covers_the_storage_service');
  });

  it('fails records kept in the project they describe', () => {
    const source = GCP_PASSING.replace(
      'destination = "storage.googleapis.com/security-archive-bucket"',
      'destination = "logging.googleapis.com/projects/customer-data/locations/global/buckets/audit"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('records_leave_the_project');
  });

  it('refuses a submission written against somebody else’s brief', () => {
    const task = taskById(GCP_ID)!;
    const result = gradeSubmission(task, GCP_PASSING, deriveTaskParams('someone_else', GCP_ID));
    expect(result.identityOk).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails an empty submission', () => {
    expect(gradeSubmission(taskById(GCP_ID)!, '', gcpParams).passed).toBe(false);
  });
});
