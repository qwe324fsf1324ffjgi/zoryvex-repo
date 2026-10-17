import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The fourth pair for ADR 0004's step one, on durability_and_recovery.
 *
 * Both tasks are about the distance between turning a protection on and
 * actually being able to get the data back, and they find that distance in
 * different places.
 *
 * On Azure it is a layering problem. Blob soft delete covers a deleted blob
 * and nothing else; the container above it and the account above that each
 * need their own mechanism, and the account's is a management lock, which is
 * not a storage setting at all.
 *
 * On GCP it is a defaults problem, and the sharper of the two. A lifecycle
 * rule with a Delete action and no with_state applies to live objects,
 * because the default is ANY. The rule runs on schedule, deletes exactly what
 * it was configured to delete, and reports success. That is graded as
 * disqualifying: it is written in rather than left out, and it destroys the
 * data the rest of the task protects.
 */

const AZURE_ID = 'task_recoverable_storage_azure_v1';
const GCP_ID = 'task_bucket_keeps_what_it_holds_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_dur', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_dur', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_storage_account" "contracts" {
  name                     = "${azureParams.token}"
  resource_group_name      = "rg-legal"
  location                 = "westeurope"
  account_tier             = "Standard"
  account_replication_type = "GZRS"

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }
}

resource "azurerm_management_lock" "contracts" {
  name       = "contracts-no-delete"
  scope      = azurerm_storage_account.contracts.id
  lock_level = "CanNotDelete"
  notes      = "Only copy of signed contracts"
}
`;

const GCP_PASSING = `
resource "google_storage_bucket" "contracts" {
  name     = "${gcpParams.token}"
  location = "EU"

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = 220752000
    is_locked        = true
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure recoverable storage', () => {
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
   * The one the task exists for. Blob soft delete is on, which is the answer
   * most people give and stop at, and deleting the container still takes
   * everything.
   */
  it('fails blob soft delete without container retention', () => {
    const source = AZURE_PASSING.replace(
      /container_delete_retention_policy \{[\s\S]*?\n {4}\}/,
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('deleted_containers_recoverable');
  });

  it('fails a retention policy of zero days', () => {
    const source = AZURE_PASSING.replace(
      'container_delete_retention_policy {\n      days = 30',
      'container_delete_retention_policy {\n      days = 0',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('deleted_containers_recoverable');
  });

  it('fails an account with no versioning, so overwrites still destroy', () => {
    const source = AZURE_PASSING.replace('versioning_enabled = true', 'versioning_enabled = false');
    expect(failed(AZURE_ID, source, azureParams)).toContain('overwrites_keep_history');
  });

  it('fails an account nothing stops anyone deleting', () => {
    const source = AZURE_PASSING.replace(
      /resource "azurerm_management_lock" "contracts" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('account_cannot_be_deleted');
  });

  it('accepts a ReadOnly lock as well as CanNotDelete', () => {
    // Stricter, not weaker. Grading only one spelling would fail a better
    // answer than the one asked for.
    const source = AZURE_PASSING.replace('lock_level = "CanNotDelete"', 'lock_level = "ReadOnly"');
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('account_cannot_be_deleted');
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

describe('GCP bucket keeps what it holds', () => {
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

  it('fails an unlocked retention policy', () => {
    const source = GCP_PASSING.replace('is_locked        = true', 'is_locked        = false');
    expect(failed(GCP_ID, source, gcpParams)).toContain('retention_is_locked');
  });

  it('fails a bucket with no versioning', () => {
    const source = GCP_PASSING.replace(/versioning \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('versioning_on');
  });

  /**
   * The disqualifying one, and the only wrong answer in the set that works
   * exactly as documented. Everything above it is correct.
   */
  it('disqualifies a lifecycle rule that deletes live objects', () => {
    const source = GCP_PASSING.replace(
      '}\n',
      `}

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365
    }
  }
`,
    );
    const task = taskById(GCP_ID)!;
    const result = gradeSubmission(task, source, gcpParams);
    expect(result.checks.find((c) => c.id === 'no_rule_deletes_live_objects')?.passed).toBe(false);
    // Not merely a lost point: the pass margin would have absorbed one miss.
    expect(result.passed).toBe(false);
    expect(result.disqualifiedBy).toBe('no_rule_deletes_live_objects');
    expect(result.disqualifiedRemedy).toBeTruthy();
  });

  it('allows a rule that deletes only archived versions', () => {
    // The feature has a legitimate use and grading it as always-wrong would
    // teach the wrong lesson. with_state is the whole difference.
    const source = GCP_PASSING.replace(
      '}\n',
      `}

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age        = 365
      with_state = "ARCHIVED"
    }
  }
`,
    );
    expect(failed(GCP_ID, source, gcpParams)).not.toContain('no_rule_deletes_live_objects');
  });

  it('allows a rule that only changes storage class', () => {
    // Not a Delete action, so with_state is irrelevant to it.
    const source = GCP_PASSING.replace(
      '}\n',
      `}

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
    condition {
      age = 90
    }
  }
`,
    );
    expect(failed(GCP_ID, source, gcpParams)).not.toContain('no_rule_deletes_live_objects');
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
