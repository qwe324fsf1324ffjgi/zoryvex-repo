import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The first pair written to ADR 0004's step one rather than to prove the
 * grader could take a non-AWS task at all.
 *
 * The two prototypes before these shared a capability and, deliberately, a
 * shape. These share a capability and do not share a shape, because the two
 * providers fail differently:
 *
 * On Azure the storage account is public the moment it exists, so the
 * candidate has to turn something off. The mistake is an omission, and a
 * submission with a private endpoint and no other change reads as finished
 * while leaving the account on the internet.
 *
 * On GCP the instance is private unless the candidate opens it, so the
 * mistake is an addition: `authorized_networks = 0.0.0.0/0` is a supported
 * feature, one line, and makes a connection problem vanish during testing.
 * That is graded as disqualifying, because it is something put in rather
 * than left out, and it is the exact outcome the task exists to prevent.
 *
 * Testing both in one file is the point: it is where the claim "the rubric
 * pattern generalises" is either true or visibly false.
 */

const AZURE_ID = 'task_private_storage_azure_v1';
const GCP_ID = 'task_private_database_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_netiso', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_netiso', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_storage_account" "docs" {
  name                          = "docsaccount"
  resource_group_name           = "rg-internal"
  location                      = "westeurope"
  account_tier                  = "Standard"
  account_replication_type      = "LRS"
  public_network_access_enabled = false
  shared_access_key_enabled     = false

  network_rules {
    default_action = "Deny"
  }
}

resource "azurerm_private_endpoint" "docs" {
  name                = "${azureParams.token}"
  location            = "westeurope"
  resource_group_name = "rg-internal"
  subnet_id           = azurerm_subnet.internal.id

  private_service_connection {
    name                           = "docs"
    private_connection_resource_id = azurerm_storage_account.docs.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }
}
`;

const GCP_PASSING = `
resource "google_sql_database_instance" "main" {
  name             = "${gcpParams.token}"
  database_version = "POSTGRES_15"
  region           = "europe-west1"

  settings {
    tier = "db-custom-2-7680"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.internal.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }
  }
}
`;

function failedIds(taskId: string, source: string, params = azureParams): string[] {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure private storage', () => {
  it('is registered with a real pass mark', () => {
    const task = taskById(AZURE_ID);
    expect(task).toBeDefined();
    // Guards the bug the derived loop exists to prevent: a task registered in
    // GRADED_TASKS but left at its literal `passMark: 0` passes an empty
    // submission.
    expect(task!.passMark).toBe(task!.checks.length - 1);
    expect(task!.passMark).toBeGreaterThan(0);
  });

  it('passes a correct answer', () => {
    const task = taskById(AZURE_ID)!;
    const result = gradeSubmission(task, AZURE_PASSING, azureParams);
    expect(result.identityOk).toBe(true);
    expect(result.passed, `failed: ${failedIds(AZURE_ID, AZURE_PASSING).join(', ')}`).toBe(true);
  });

  it('fails a private endpoint that leaves the public one open', () => {
    // The whole point of the task. This submission looks complete and works.
    const source = AZURE_PASSING.replace('public_network_access_enabled = false', '');
    expect(failedIds(AZURE_ID, source)).toContain('public_endpoint_off');
  });

  it('does not accept public_network_access_enabled set to true', () => {
    const source = AZURE_PASSING.replace(
      'public_network_access_enabled = false',
      'public_network_access_enabled = true',
    );
    expect(failedIds(AZURE_ID, source)).toContain('public_endpoint_off');
  });

  it('fails network rules that default to Allow', () => {
    const source = AZURE_PASSING.replace('default_action = "Deny"', 'default_action = "Allow"');
    expect(failedIds(AZURE_ID, source)).toContain('default_deny');
  });

  it('fails an account that still permits its shared key', () => {
    const source = AZURE_PASSING.replace(
      'shared_access_key_enabled     = false',
      'shared_access_key_enabled     = true',
    );
    expect(failedIds(AZURE_ID, source)).toContain('no_account_key');
  });

  it('fails a private endpoint wired to nothing', () => {
    // An endpoint with no private_service_connection is a resource that
    // creates cleanly and connects to no service.
    const source = AZURE_PASSING.replace(/private_service_connection \{[\s\S]*?\n {2}\}/, '');
    expect(failedIds(AZURE_ID, source)).toContain('private_endpoint');
  });

  it('refuses a submission written against somebody else’s brief', () => {
    const task = taskById(AZURE_ID)!;
    const other = deriveTaskParams('cand_someone_else', AZURE_ID);
    const result = gradeSubmission(task, AZURE_PASSING, other);
    expect(result.identityOk).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails an empty submission', () => {
    const task = taskById(AZURE_ID)!;
    expect(gradeSubmission(task, '', azureParams).passed).toBe(false);
  });
});

describe('GCP private database', () => {
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
    expect(result.passed, `failed: ${failedIds(GCP_ID, GCP_PASSING, gcpParams).join(', ')}`).toBe(
      true,
    );
  });

  it('fails an instance given a public address', () => {
    const source = GCP_PASSING.replace('ipv4_enabled    = false', 'ipv4_enabled    = true');
    expect(failedIds(GCP_ID, source, gcpParams)).toContain('no_public_ip');
  });

  it('fails an instance attached to no private network', () => {
    const source = GCP_PASSING.replace('private_network = google_compute_network.internal.id', '');
    expect(failedIds(GCP_ID, source, gcpParams)).toContain('private_network');
  });

  it('fails an unencrypted connection policy', () => {
    const source = GCP_PASSING.replace('ssl_mode        = "ENCRYPTED_ONLY"', '');
    expect(failedIds(GCP_ID, source, gcpParams)).toContain('encrypted_connections');
  });

  it('accepts the older require_ssl spelling', () => {
    // Both are current in the wild depending on provider version, and the
    // task is about the decision, not about which attribute name the
    // candidate learned it under.
    const source = GCP_PASSING.replace('ssl_mode        = "ENCRYPTED_ONLY"', 'require_ssl = true');
    expect(failedIds(GCP_ID, source, gcpParams)).not.toContain('encrypted_connections');
  });

  /**
   * The one that carries the task.
   *
   * Everything else in this submission is right, including no public
   * address. A reviewer skimming for `ipv4_enabled` sees a correct answer.
   */
  it('disqualifies an authorized network covering the whole internet', () => {
    const source = GCP_PASSING.replace(
      'ssl_mode        = "ENCRYPTED_ONLY"',
      `ssl_mode        = "ENCRYPTED_ONLY"

      authorized_networks {
        name  = "office"
        value = "0.0.0.0/0"
      }`,
    );
    const task = taskById(GCP_ID)!;
    const result = gradeSubmission(task, source, gcpParams);

    expect(result.checks.find((c) => c.id === 'no_open_authorized_network')?.passed).toBe(false);
    // Not merely a lost point. The pass margin would have absorbed one miss.
    expect(result.passed).toBe(false);
    expect(result.disqualifiedBy).toBe('no_open_authorized_network');
    expect(result.disqualifiedRemedy).toBeTruthy();
  });

  it('allows a genuinely narrow authorized network', () => {
    // The feature has a legitimate use, and grading it as always-wrong would
    // teach the wrong lesson.
    const source = GCP_PASSING.replace(
      'ssl_mode        = "ENCRYPTED_ONLY"',
      `ssl_mode        = "ENCRYPTED_ONLY"

      authorized_networks {
        name  = "office"
        value = "203.0.113.4/32"
      }`,
    );
    expect(failedIds(GCP_ID, source, gcpParams)).not.toContain('no_open_authorized_network');
  });

  it('refuses a submission written against somebody else’s brief', () => {
    const task = taskById(GCP_ID)!;
    const other = deriveTaskParams('cand_someone_else', GCP_ID);
    const result = gradeSubmission(task, GCP_PASSING, other);
    expect(result.identityOk).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails an empty submission', () => {
    const task = taskById(GCP_ID)!;
    expect(gradeSubmission(task, '', gcpParams).passed).toBe(false);
  });
});
