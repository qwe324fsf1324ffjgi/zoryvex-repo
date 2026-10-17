import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The second non-AWS task, and the one that tests the pattern rather than
 * the parser.
 *
 * Azure proved the grader does not care which provider a resource belongs
 * to. It did not prove a rubric shape survives a genuinely different access
 * model. GCP has one: there is no scope attribute to read, because the scope
 * IS the resource type. A binding on a bucket and the same role granted
 * project-wide are two different resources.
 */

const TASK_ID = 'task_scoped_identity_gcp_v1';
const CANDIDATE = 'cand_gcp_prototype';
const params = deriveTaskParams(CANDIDATE, TASK_ID);

const PASSING = `
resource "google_service_account" "run" {
  account_id   = "${params.token}"
  display_name = "Cloud Run reader"
}

resource "google_storage_bucket_iam_member" "run_read" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:\${google_service_account.run.email}"
}

resource "google_cloud_run_v2_service" "app" {
  name     = "app"
  location = "europe-west1"
  template {
    service_account = google_service_account.run.email
  }
}
`;

describe('the GCP task grades like any other', () => {
  it('is registered with a real pass mark', () => {
    const task = taskById(TASK_ID);
    expect(task).toBeDefined();
    expect(task!.passMark).toBe(task!.checks.length - 1);
  });

  it('passes a correct answer', () => {
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(task, PASSING, params);
    expect(result.identityOk).toBe(true);
    expect(
      result.passed,
      `failed: ${result.checks
        .filter((c) => !c.passed)
        .map((c) => c.id)
        .join(', ')}`,
    ).toBe(true);
  });

  it('fails roles/editor, however correct the rest is', () => {
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(
      task,
      PASSING.replace('roles/storage.objectViewer', 'roles/editor'),
      params,
    );
    expect(result.checks.find((c) => c.id === 'viewer_not_admin')?.passed).toBe(false);
  });

  /**
   * The check that had to be written differently, and turned out simpler.
   *
   * On Azure this needed a regex over a scope expression to tell a container
   * from a subscription. On GCP the scope is the resource type, so it is two
   * calls to findResources. A different access model made the rubric easier
   * to express, not harder.
   */
  it('fails a project-wide binding, which on GCP is a different resource entirely', () => {
    const task = taskById(TASK_ID)!;
    const projectWide = PASSING.replace(
      'resource "google_storage_bucket_iam_member" "run_read" {\n  bucket = google_storage_bucket.uploads.name',
      'resource "google_project_iam_member" "run_read" {\n  project = "my-project"',
    );
    const result = gradeSubmission(task, projectWide, params);
    expect(result.checks.find((c) => c.id === 'not_project_wide')?.passed).toBe(false);
  });

  it('fails a downloaded service account key', () => {
    const task = taskById(TASK_ID)!;
    const withKey = `${PASSING}
resource "google_service_account_key" "run" {
  service_account_id = google_service_account.run.name
}
`;
    const result = gradeSubmission(task, withKey, params);
    expect(result.checks.find((c) => c.id === 'no_service_account_key')?.passed).toBe(false);
  });

  it('refuses work submitted under somebody else name', () => {
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(task, PASSING.replace(params.token, 'someone-else'), params);
    expect(result.identityOk).toBe(false);
  });
});

/**
 * The point of prototyping a second provider rather than stopping at one.
 */
describe('whether the pattern generalises', () => {
  const TASKS = [
    'task_least_privilege_role_v1',
    'task_scoped_identity_azure_v1',
    'task_scoped_identity_gcp_v1',
  ];

  it('tests the same capability on all three providers', () => {
    for (const id of TASKS) {
      expect(taskById(id)!.capabilities, id).toEqual(['least_privilege_access']);
    }
  });

  it('gives all three the same shape: same check count, same pass margin', () => {
    // If each provider had needed its own rubric size, thirty tasks per cloud
    // would be thirty separate design problems rather than one repeated.
    const shapes = TASKS.map((id) => {
      const t = taskById(id)!;
      return { checks: t.checks.length, margin: t.checks.length - t.passMark };
    });
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[1]).toEqual(shapes[2]);
  });

  /**
   * The finding worth carrying into the remaining tasks: the three ways least
   * privilege is lost are the same three everywhere, wearing different names.
   * Too broad a role, too wide a scope, a long-lived key. Each provider ships
   * its own version of all three.
   */
  it('covers the same three failure modes under each provider name', () => {
    const byId = (id: string) => taskById(id)!.checks.map((c) => c.id);
    expect(byId('task_least_privilege_role_v1')).toEqual(
      expect.arrayContaining(['no_wildcard_action', 'scoped_resources']),
    );
    expect(byId('task_scoped_identity_azure_v1')).toEqual(
      expect.arrayContaining(['reader_not_owner', 'scoped_assignment', 'no_storage_key']),
    );
    expect(byId('task_scoped_identity_gcp_v1')).toEqual(
      expect.arrayContaining(['viewer_not_admin', 'not_project_wide', 'no_service_account_key']),
    );
  });

  it('keeps each provider ignorant of the others', () => {
    // A submission for one cloud must not accidentally satisfy another's
    // rubric, or a candidate could pass the Azure task with GCP Terraform.
    const gcp = taskById('task_scoped_identity_gcp_v1')!;
    const azureParams = deriveTaskParams(CANDIDATE, 'task_scoped_identity_azure_v1');
    const azureAnswer = `
resource "azurerm_user_assigned_identity" "fn" {
  name = "${azureParams.token}"
}
resource "azurerm_role_assignment" "fn" {
  scope                = azurerm_storage_container.uploads.resource_manager_id
  role_definition_name = "Storage Blob Data Reader"
}
`;
    const result = gradeSubmission(gcp, azureAnswer, params);
    expect(result.identityOk).toBe(false);
    expect(result.passed).toBe(false);
  });
});
