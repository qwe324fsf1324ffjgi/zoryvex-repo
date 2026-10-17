import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The eighth pair for ADR 0004's step one, on data_protection.
 *
 * Both tasks are about the same realisation: bringing your own key moves the
 * risk rather than removing it, because the data becomes exactly as durable
 * as the key. Where they differ is where the key can be lost.
 *
 * On Azure it is the platform. Soft delete gives a window to undo a deletion
 * and purge protection is what stops somebody emptying the bin during it.
 * Without purge protection one purge makes every byte under that key
 * permanently unreadable at any support tier, which is why Azure refuses to
 * let a vault without it be used for storage encryption at all.
 *
 * On GCP the platform has largely closed that: a key version waits out a
 * destruction period by default. So the risk moves into Terraform, where a
 * destroy or a refactor is what parts a key from its data, and prevent_destroy
 * stops the plan rather than the API.
 */

const AZURE_ID = 'task_key_you_cannot_lose_azure_v1';
const GCP_ID = 'task_key_you_control_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_dp', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_dp', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_key_vault" "keys" {
  name                       = "${azureParams.token}"
  resource_group_name        = "rg-security"
  location                   = "westeurope"
  tenant_id                  = "00000000-0000-0000-0000-000000000000"
  sku_name                   = "standard"
  soft_delete_retention_days = 90
  purge_protection_enabled   = true
}

resource "azurerm_key_vault_key" "records" {
  name         = "records-cmk"
  key_vault_id = azurerm_key_vault.keys.id
  key_type     = "RSA"
  key_size     = 4096
  key_opts     = ["unwrapKey", "wrapKey"]
}

resource "azurerm_storage_account" "records" {
  name                      = "recordsaccount"
  resource_group_name       = "rg-security"
  location                  = "westeurope"
  account_tier              = "Standard"
  account_replication_type  = "GZRS"
  min_tls_version           = "TLS1_2"
  https_traffic_only_enabled = true
}

resource "azurerm_storage_account_customer_managed_key" "records" {
  storage_account_id = azurerm_storage_account.records.id
  key_vault_id       = azurerm_key_vault.keys.id
  key_name           = azurerm_key_vault_key.records.name
}
`;

const GCP_PASSING = `
resource "google_kms_key_ring" "records" {
  name     = "records-ring"
  location = "europe-west1"
}

resource "google_kms_crypto_key" "records" {
  name            = "${gcpParams.token}"
  key_ring        = google_kms_key_ring.records.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket" "records" {
  name                        = "customer-records"
  location                    = "EU"
  uniform_bucket_level_access = true

  encryption {
    default_kms_key_name = google_kms_crypto_key.records.id
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure key you cannot lose', () => {
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
   * The one the task exists for. Soft delete is on, so this reads as
   * protected, and one purge inside the window still destroys everything.
   */
  it('fails soft delete without purge protection', () => {
    const source = AZURE_PASSING.replace('purge_protection_enabled   = true', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('nobody_can_force_the_delete');
  });

  it('fails purge protection explicitly turned off', () => {
    const source = AZURE_PASSING.replace(
      'purge_protection_enabled   = true',
      'purge_protection_enabled   = false',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('nobody_can_force_the_delete');
  });

  it('fails a vault and key never connected to the account', () => {
    const source = AZURE_PASSING.replace(
      /resource "azurerm_storage_account_customer_managed_key" "records" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('account_uses_the_key');
  });

  it('fails obsolete TLS', () => {
    const source = AZURE_PASSING.replace(
      'min_tls_version           = "TLS1_2"',
      'min_tls_version           = "TLS1_0"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('current_transport_security');
  });

  it('fails plain HTTP being allowed', () => {
    const source = AZURE_PASSING.replace(
      'https_traffic_only_enabled = true',
      'https_traffic_only_enabled = false',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('current_transport_security');
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

describe('GCP key you control', () => {
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

  it('fails a key that never rotates', () => {
    const source = GCP_PASSING.replace('rotation_period = "7776000s"', '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('key_rotates');
  });

  /**
   * The Terraform-side failure. The API would not have destroyed this key;
   * a plan would.
   */
  it('fails a key the plan is free to destroy', () => {
    const source = GCP_PASSING.replace(/lifecycle \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('config_cannot_take_the_key_with_it');
  });

  it('fails a bucket still on Google-managed encryption', () => {
    const source = GCP_PASSING.replace(/encryption \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('bucket_uses_the_key');
  });

  it('fails legacy per-object ACLs being available', () => {
    const source = GCP_PASSING.replace(
      'uniform_bucket_level_access = true',
      'uniform_bucket_level_access = false',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('no_per_object_permissions');
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
