import { describe, expect, it } from 'vitest';
import {
  GRADED_TASKS,
  deriveTaskParams,
  gradeSubmission,
  taskById,
} from '../src/domain/graded-task-service';

/**
 * The first task graded against a cloud that is not AWS.
 *
 * The prototype exists to answer one question: can this grader mark work on
 * another provider without changing anything underneath it? These tests are
 * the answer. `parseHcl` and `findResources` filter HCL blocks by type and
 * label and have never known which provider a resource belongs to, so the
 * whole of Azure support here is a task definition.
 */

const TASK_ID = 'task_scoped_identity_azure_v1';
const CANDIDATE = 'cand_azure_prototype';
const params = deriveTaskParams(CANDIDATE, TASK_ID);

/** A correct answer: identity, read-only role, scoped at the container, no keys. */
const PASSING = `
resource "azurerm_user_assigned_identity" "fn" {
  name                = "${params.token}"
  resource_group_name = "rg-app"
  location            = "westeurope"
}

resource "azurerm_role_assignment" "fn_blob_read" {
  scope                = azurerm_storage_container.uploads.resource_manager_id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.fn.principal_id
}
`;

describe('the Azure task grades like any other', () => {
  it('is offered by the registry and carries a real pass mark', () => {
    // The trap this catches: passMark is set by a loop listing every task by
    // name, separate from the definitions. A task left out of that loop keeps
    // passMark 0, which means every submission clears it, including an empty
    // one. Nothing else in the suite would have noticed.
    const task = taskById(TASK_ID);
    expect(task).toBeDefined();
    expect(task!.passMark).toBeGreaterThan(0);
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

  /**
   * The three ways least privilege is actually lost on Azure. Each is a
   * separate check because each teaches something different, and a candidate
   * who trips one should be told which.
   */
  it('fails a broad built-in role, however correct the rest is', () => {
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(
      task,
      PASSING.replace('Storage Blob Data Reader', 'Contributor'),
      params,
    );
    expect(result.checks.find((c) => c.id === 'reader_not_owner')?.passed).toBe(false);
  });

  it('fails an assignment scoped at the subscription rather than the resource', () => {
    const task = taskById(TASK_ID)!;
    const subscriptionScoped = PASSING.replace(
      'scope                = azurerm_storage_container.uploads.resource_manager_id',
      'scope                = data.azurerm_subscription.current.id',
    );
    const result = gradeSubmission(task, subscriptionScoped, params);
    expect(result.checks.find((c) => c.id === 'scoped_assignment')?.passed).toBe(false);
  });

  it('fails a submission that reaches for a storage key instead of the identity', () => {
    const task = taskById(TASK_ID)!;
    const withKey = `${PASSING}
resource "azurerm_linux_function_app" "fn" {
  name                       = "fn-app"
  storage_account_access_key = azurerm_storage_account.data.primary_access_key
}
`;
    const result = gradeSubmission(task, withKey, params);
    expect(result.checks.find((c) => c.id === 'no_storage_key')?.passed).toBe(false);
  });

  it('refuses work submitted under somebody else name', () => {
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(task, PASSING.replace(params.token, 'someone-else'), params);
    expect(result.identityOk).toBe(false);
  });
});

describe('what the prototype proves about the architecture', () => {
  it('needed no new capability, so it is offered wherever that capability is', () => {
    // least_privilege_access was named for what a person does rather than for
    // IAM, which is why an Azure task testing it slots into the existing
    // tracks with no new track and no branching in the selection code.
    const task = taskById(TASK_ID)!;
    expect(task.capabilities).toEqual(['least_privilege_access']);
  });

  it('is graded by the same parser as every AWS task, with no provider switch', () => {
    // If the grader had any AWS-specific parsing, an azurerm-only submission
    // would score zero rather than five. It scores five.
    const task = taskById(TASK_ID)!;
    const result = gradeSubmission(task, PASSING, params);
    expect(result.score).toBe(task.checks.length);
    expect(PASSING).not.toContain('aws_');
  });

  it('leaves every other task exactly as it was', () => {
    // A prototype that changed how the existing 30 are graded would not be a
    // prototype, it would be a rewrite with one new file in it.
    const awsTasks = GRADED_TASKS.filter((t) => t.id !== TASK_ID);
    expect(awsTasks.length).toBe(GRADED_TASKS.length - 1);
    for (const task of awsTasks) {
      expect(task.passMark, `${task.id} pass mark`).toBe(task.checks.length - 1);
    }
  });
});
