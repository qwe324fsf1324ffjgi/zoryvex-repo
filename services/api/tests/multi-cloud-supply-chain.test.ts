import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The ninth pair for ADR 0004's step one, on supply_chain_integrity.
 *
 * The AWS task for this capability grades the image. These grade what stands
 * around it, because that is where each provider's reachable mistake lives.
 *
 * Azure's is a convenience feature. `admin_enabled` creates one username and
 * password with push rights over the whole registry, shared by everyone and
 * attributable to no one. It is one line and it makes every authentication
 * problem disappear, which is why it survives in production long after the
 * afternoon it was needed.
 *
 * GCP's is the opposite kind of failure, and the sharper one. Binary
 * Authorization is the strongest control in this capability on any provider,
 * and a policy set to ALWAYS_ALLOW is not a weaker version of it. It is the
 * absence of the control with a resource in the plan, a name in the console,
 * and a line in a compliance document saying it is enabled. The claim outlives
 * the check, which is how it passes an audit that a missing policy would fail.
 */

const AZURE_ID = 'task_registry_not_a_back_door_azure_v1';
const GCP_ID = 'task_only_signed_images_run_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_supply', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_supply', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_container_registry" "images" {
  name                      = "${azureParams.token}"
  resource_group_name       = "rg-platform"
  location                  = "westeurope"
  sku                       = "Premium"
  admin_enabled             = false
  anonymous_pull_enabled    = false
  quarantine_policy_enabled = true

  retention_policy {
    days    = 90
    enabled = true
  }
}
`;

const GCP_PASSING = `
resource "google_binary_authorization_attestor" "build" {
  name = "${gcpParams.token}"

  attestation_authority_note {
    note_reference = google_container_analysis_note.build.name
  }
}

resource "google_binary_authorization_policy" "production" {
  admission_whitelist_patterns {
    name_pattern = "gke.gcr.io/*"
  }

  default_admission_rule {
    evaluation_mode         = "REQUIRE_ATTESTATION"
    enforcement_mode        = "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = [google_binary_authorization_attestor.build.name]
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure registry not a back door', () => {
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

  /** The one the task exists for. */
  it('fails the shared admin credential', () => {
    const source = AZURE_PASSING.replace(
      'admin_enabled             = false',
      'admin_enabled             = true',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('no_shared_admin_credential');
  });

  it('accepts the admin flag simply being absent, since the default is off', () => {
    // Refusing a submission for not writing out a safe default would be
    // grading style rather than the decision.
    const source = AZURE_PASSING.replace('  admin_enabled             = false\n', '');
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('no_shared_admin_credential');
  });

  it('fails a registry anybody can pull from', () => {
    const source = AZURE_PASSING.replace(
      'anonymous_pull_enabled    = false',
      'anonymous_pull_enabled    = true',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('not_readable_by_anyone');
  });

  it('fails a registry with nothing preserving published content', () => {
    const source = AZURE_PASSING.replace(/retention_policy \{[\s\S]*?\n {2}\}/, '').replace(
      'quarantine_policy_enabled = true',
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('published_tags_cannot_move');
  });

  it('fails a floating tag on anything deployed alongside it', () => {
    const source = `${AZURE_PASSING}
resource "azurerm_container_app" "api" {
  name                         = "api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = "rg-platform"

  template {
    container {
      name  = "api"
      image = "example.azurecr.io/api:latest"
    }
  }
}
`;
    expect(failed(AZURE_ID, source, azureParams)).toContain('deployments_pin_the_image');
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

describe('GCP only signed images run', () => {
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
   * The policy that exists, deploys, is named in the console, and gates
   * nothing. Worse than having no policy, because the claim survives.
   */
  it('fails a policy set to allow everything', () => {
    const source = GCP_PASSING.replace(
      'evaluation_mode         = "REQUIRE_ATTESTATION"',
      'evaluation_mode         = "ALWAYS_ALLOW"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('default_is_refusal');
  });

  it('fails a rule that trusts nobody in particular', () => {
    // REQUIRE_ATTESTATION with an empty list can never be satisfied, so
    // nothing deploys and the usual fix under pressure is to weaken the mode.
    const source = GCP_PASSING.replace(
      'require_attestations_by = [google_binary_authorization_attestor.build.name]',
      '',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('rule_names_the_attestor');
  });

  it('fails a policy that would block the platform’s own images', () => {
    const source = GCP_PASSING.replace(/admission_whitelist_patterns \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('system_images_still_allowed');
  });

  it('fails an attestor with no policy behind it', () => {
    const source = GCP_PASSING.replace(
      /resource "google_binary_authorization_policy" "production" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('policy_exists');
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
