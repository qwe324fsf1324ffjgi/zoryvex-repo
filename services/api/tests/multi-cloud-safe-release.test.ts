import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The seventh pair for ADR 0004's step one, on safe_release.
 *
 * The closest parallel in the whole set, and the only capability where both
 * providers make the same mistake in the same shape. Azure Container Apps and
 * Cloud Run both split traffic with an explicit block, and both default that
 * block to sending everything to the newest revision.
 *
 * That is what makes it worth grading. The dangerous configuration is written
 * down rather than defaulted into silence, so it survives review: traffic
 * weights are present, somebody clearly thought about rollout, and the number
 * is simply the one that removes the entire point of having the block.
 *
 * Where they genuinely differ is the rollback. Cloud Run keeps every revision
 * addressable by name forever, so naming the one holding the rest of the
 * traffic costs a line and makes going back a single edit. Container Apps
 * needs the revision mode set to Multiple before any of it means anything,
 * because in Single mode there is no second revision to split with.
 */

const AZURE_ID = 'task_canary_before_everyone_azure_v1';
const GCP_ID = 'task_canary_before_everyone_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_release', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_release', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_container_app" "api" {
  name                         = "${azureParams.token}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = "rg-prod"
  revision_mode                = "Multiple"

  template {
    container {
      name   = "api"
      image  = "registry.example.io/api@sha256:3f1a9c0e5b8d7a2f4c6e1b0d9a8f7c6e5d4b3a2f1e0d9c8b7a6f5e4d3c2b1a09"
      cpu    = 0.5
      memory = "1Gi"
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080

    traffic_weight {
      latest_revision = true
      percentage      = 10
    }

    traffic_weight {
      revision_suffix = "stable"
      percentage      = 90
    }
  }
}
`;

const GCP_PASSING = `
resource "google_cloud_run_v2_service" "api" {
  name     = "${gcpParams.token}"
  location = "europe-west1"

  template {
    containers {
      image = "europe-docker.pkg.dev/example/api/api@sha256:3f1a9c0e5b8d7a2f4c6e1b0d9a8f7c6e5d4b3a2f1e0d9c8b7a6f5e4d3c2b1a09"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 10
  }

  traffic {
    type     = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION"
    revision = "api-00042-abc"
    percent  = 90
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure canary before everyone', () => {
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
   * The one the task exists for. Traffic weights are present and deliberate,
   * and the number makes them do nothing.
   */
  it('fails sending all traffic to the latest revision', () => {
    const source = AZURE_PASSING.replace(
      'latest_revision = true\n      percentage      = 10',
      'latest_revision = true\n      percentage      = 100',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('new_version_is_not_everybody');
  });

  it('fails Single revision mode, where a weight block cannot do anything', () => {
    const source = AZURE_PASSING.replace('revision_mode                = "Multiple"', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('multiple_revisions_allowed');
  });

  it('fails a floating latest tag', () => {
    const source = AZURE_PASSING.replace(
      /image {2}= "[^"]*"/,
      'image  = "registry.example.io/api:latest"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('image_cannot_change_underneath');
  });

  it('accepts a real version tag as pinned', () => {
    // A digest is best, but a specific version tag is a genuine answer and
    // failing it would be grading a preference rather than the decision.
    const source = AZURE_PASSING.replace(
      /image {2}= "[^"]*"/,
      'image  = "registry.example.io/api:1.4.2"',
    );
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('image_cannot_change_underneath');
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

describe('GCP canary before everyone', () => {
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

  it('fails the console default of everything to latest', () => {
    const source = GCP_PASSING.replace(
      'type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"\n    percent = 10',
      'type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"\n    percent = 100',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('latest_is_not_everything');
  });

  it('fails when no revision is named to fall back to', () => {
    const source = GCP_PASSING.replace('revision = "api-00042-abc"', '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('rollback_target_is_named');
  });

  it('fails a floating latest tag', () => {
    const source = GCP_PASSING.replace(
      /image = "[^"]*"/,
      'image = "europe-docker.pkg.dev/example/api/api:latest"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('image_is_pinned');
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
