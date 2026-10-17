import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The tenth and last pair for ADR 0004's step one, on reproducible_data_path.
 * With these, every capability across all four tracks has a task on all three
 * providers.
 *
 * Both grade a run by four things that only work together: the code cannot
 * move, the input cannot change, the output does not land on the input, and
 * the previous outputs survive a rerun.
 *
 * These are also the only two tasks in the whole set that insist on a digest
 * rather than accepting a version tag, and the distinction is deliberate. The
 * safe_release pair accepts `api:1.4.2`, because that question is whether a
 * specific build is healthy and a tag answers it. Here the question is what
 * actually ran a year ago, and "we ran 1.4.2" is only as good as nobody having
 * moved 1.4.2 since, which a rerun cannot establish. A tag is a promise; a
 * digest is arithmetic.
 *
 * The providers then diverge on how the previous result is protected. Azure
 * retains deletions, so an overwritten result can be recovered. GCP can refuse
 * the write outright with a retention policy, which holds whoever runs the job
 * and whatever the job intends.
 */

const AZURE_ID = 'task_rerunnable_job_azure_v1';
const GCP_ID = 'task_rerunnable_job_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_repro', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_repro', GCP_ID);

const DIGEST = '@sha256:3f1a9c0e5b8d7a2f4c6e1b0d9a8f7c6e5d4b3a2f1e0d9c8b7a6f5e4d3c2b1a09';

const AZURE_PASSING = `
resource "azurerm_container_app_job" "training" {
  name                         = "${azureParams.token}"
  container_app_environment_id = azurerm_container_app_environment.ml.id
  resource_group_name          = "rg-ml"

  template {
    container {
      name   = "train"
      image  = "registry.example.io/train${DIGEST}"
      cpu    = 2
      memory = "8Gi"
    }
  }
}

resource "azurerm_storage_account" "datasets" {
  name                     = "mldatasets"
  resource_group_name      = "rg-ml"
  location                 = "westeurope"
  account_tier             = "Standard"
  account_replication_type = "GZRS"

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 180
    }
  }
}

resource "azurerm_storage_container" "input" {
  name                  = "datasets"
  storage_account_id    = azurerm_storage_account.datasets.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "output" {
  name                  = "model-runs"
  storage_account_id    = azurerm_storage_account.datasets.id
  container_access_type = "private"
}
`;

const GCP_PASSING = `
resource "google_cloud_run_v2_job" "training" {
  name     = "${gcpParams.token}"
  location = "europe-west1"

  template {
    template {
      containers {
        image = "europe-docker.pkg.dev/example/ml/train${DIGEST}"
      }
    }
  }
}

resource "google_storage_bucket" "input" {
  name     = "ml-datasets"
  location = "EU"

  versioning {
    enabled = true
  }
}

resource "google_storage_bucket" "output" {
  name     = "ml-model-runs"
  location = "EU"

  retention_policy {
    retention_period = 31536000
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure rerunnable job', () => {
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
   * The distinction from safe_release, asserted rather than only argued in a
   * comment. A version tag is a good answer there and not here.
   */
  it('fails a version tag, which the rollout tasks accept', () => {
    const source = AZURE_PASSING.replace(
      `image  = "registry.example.io/train${DIGEST}"`,
      'image  = "registry.example.io/train:1.4.2"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('code_pinned_by_digest');
  });

  it('fails an input the next overwrite erases', () => {
    const source = AZURE_PASSING.replace('versioning_enabled = true', 'versioning_enabled = false');
    expect(failed(AZURE_ID, source, azureParams)).toContain('input_keeps_its_history');
  });

  it('fails writing results back where the input lives', () => {
    const source = AZURE_PASSING.replace(
      /resource "azurerm_storage_container" "output" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('output_is_somewhere_else');
  });

  it('fails a rerun that can erase the previous result', () => {
    const source = AZURE_PASSING.replace(/delete_retention_policy \{[\s\S]*?\n {4}\}/, '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('previous_results_survive_a_rerun');
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

describe('GCP rerunnable job', () => {
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

  it('fails a version tag here too', () => {
    const source = GCP_PASSING.replace(
      `image = "europe-docker.pkg.dev/example/ml/train${DIGEST}"`,
      'image = "europe-docker.pkg.dev/example/ml/train:1.4.2"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('job_code_pinned_by_digest');
  });

  it('fails an input bucket with no history', () => {
    const source = GCP_PASSING.replace(/versioning \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('input_bucket_versioned');
  });

  it('fails one bucket doing both jobs', () => {
    const source = GCP_PASSING.replace(
      /resource "google_storage_bucket" "output" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('separate_output_bucket');
  });

  /**
   * The lever Azure does not have in this shape: the storage refuses the
   * write rather than retaining what it replaced.
   */
  it('fails relying on the job to be careful instead of the bucket refusing', () => {
    const source = GCP_PASSING.replace(/retention_policy \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('storage_refuses_to_overwrite_results');
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
