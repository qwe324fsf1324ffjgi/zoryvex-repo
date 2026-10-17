import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The fifth and last pair for ADR 0004's step one, on cost_control. With
 * these, every capability the aws_cloud track claims has a task on all three
 * providers.
 *
 * A budget is a notification on every cloud. None of the three will stop
 * spending, so the only thing a budget buys is time to react, and both tasks
 * are about whether that time is longer than zero.
 *
 * Azure and GCP make the same mistake available under different names:
 * threshold_type defaults to Actual, spend_basis defaults to CURRENT_SPEND,
 * and both report money already spent. On a steady bill that is a few days of
 * warning; on a runaway it is hours, and usually none.
 *
 * Where they differ is who hears. Azure's notification has no recipients
 * unless you give it some, which is at least visibly empty. GCP's budget
 * without an all_updates_rule quietly emails the billing administrators,
 * which is a real notification sent to the wrong people, and that is harder
 * to notice than silence.
 */

const AZURE_ID = 'task_budget_warns_in_time_azure_v1';
const GCP_ID = 'task_budget_tells_the_right_people_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_cost', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_cost', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_consumption_budget_resource_group" "pipeline" {
  name              = "${azureParams.token}"
  resource_group_id = azurerm_resource_group.pipeline.id
  amount            = 500
  time_grain        = "Monthly"

  notification {
    enabled        = true
    threshold      = 80
    threshold_type = "Forecasted"
    operator       = "GreaterThan"
    contact_emails = ["platform@example.internal"]
  }
}
`;

const GCP_PASSING = `
resource "google_billing_budget" "pipeline" {
  billing_account = "billingAccounts/example"
  display_name    = "${gcpParams.token}"

  amount {
    specified_amount {
      currency_code = "EUR"
      units         = "500"
    }
  }

  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.platform.id]
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure budget warns in time', () => {
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

  it('accepts a subscription-scoped budget as readily as a resource-group one', () => {
    // Both are correct answers to the brief, which does not say which scope
    // to use. Reading only one resource type would fail a good submission for
    // choosing the other.
    const source = AZURE_PASSING.replace(
      'azurerm_consumption_budget_resource_group" "pipeline" {\n  name              = ',
      'azurerm_consumption_budget_subscription" "pipeline" {\n  name              = ',
    ).replace('resource_group_id = azurerm_resource_group.pipeline.id', 'subscription_id = "sub"');
    const task = taskById(AZURE_ID)!;
    const result = gradeSubmission(task, source, azureParams);
    expect(result.identityOk).toBe(true);
    expect(result.passed, `failed: ${failed(AZURE_ID, source, azureParams).join(', ')}`).toBe(true);
  });

  /**
   * The one the task exists for. Everything else is right and the alert
   * arrives after the money is gone.
   */
  it('fails a budget that only reports spend already made', () => {
    const source = AZURE_PASSING.replace(
      'threshold_type = "Forecasted"',
      'threshold_type = "Actual"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('forecast_not_just_actual');
  });

  it('fails when threshold_type is simply left at its default', () => {
    const source = AZURE_PASSING.replace('    threshold_type = "Forecasted"\n', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('forecast_not_just_actual');
  });

  it('fails a notification with nobody to send to', () => {
    const source = AZURE_PASSING.replace(
      '    contact_emails = ["platform@example.internal"]\n',
      '',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('budget_reaches_a_person');
  });

  it('fails a threshold that only fires once the budget is gone', () => {
    const source = AZURE_PASSING.replace('threshold      = 80', 'threshold      = 100');
    expect(failed(AZURE_ID, source, azureParams)).toContain('warns_below_the_limit');
  });

  it('fails an annual grain, which is a twelfth as strict for the same number', () => {
    const source = AZURE_PASSING.replace(
      'time_grain        = "Monthly"',
      'time_grain        = "Annually"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('budget_has_an_amount');
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

describe('GCP budget tells the right people', () => {
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
   * The check the task turns on. Without the rule the budget still notifies,
   * which is why this is harder to spot than silence would be: it reaches
   * the billing administrators rather than the engineers who could act.
   */
  it('fails a budget that only reaches whoever owns billing', () => {
    const source = GCP_PASSING.replace(/all_updates_rule \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('notifies_beyond_billing_admins');
  });

  it('accepts a pubsub topic instead of a notification channel', () => {
    // Routing the update into a topic something else consumes is a real
    // answer, not a worse one.
    const source = GCP_PASSING.replace(
      'monitoring_notification_channels = [google_monitoring_notification_channel.platform.id]',
      'pubsub_topic = google_pubsub_topic.budget.id',
    );
    expect(failed(GCP_ID, source, gcpParams)).not.toContain('notifies_beyond_billing_admins');
  });

  it('fails a budget with no threshold rules, which notifies about nothing', () => {
    const source = GCP_PASSING.replace(/threshold_rules \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('has_threshold_rules');
  });

  it('fails a rule left on current spend', () => {
    const source = GCP_PASSING.replace(
      'spend_basis       = "FORECASTED_SPEND"',
      'spend_basis       = "CURRENT_SPEND"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('forecast_not_just_current');
  });

  it('fails a threshold at the full amount', () => {
    const source = GCP_PASSING.replace('threshold_percent = 0.8', 'threshold_percent = 1.0');
    expect(failed(GCP_ID, source, gcpParams)).toContain('warns_below_the_amount');
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
