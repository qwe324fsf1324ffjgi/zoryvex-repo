import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The second pair written to ADR 0004's step one, on the capability every
 * one of the four tracks claims.
 *
 * These pair with ALARM_THAT_FIRES on AWS, and the three together are the
 * clearest evidence for the ADR's thesis that is available anywhere in the
 * task set. The AWS task turns on `treat_missing_data`, because an alarm
 * watching an error count sits quiet through a total outage: a dead service
 * reports no errors, and CloudWatch's default for no data is to do nothing.
 *
 * GCP sets the identical trap under a different name. `evaluation_missing_data`
 * defaults to NO_OP with exactly the same consequence. That is not one
 * vendor's quirk being tested twice; it is a property of how threshold
 * alerting works, and a candidate who understands it on one cloud has
 * something transferable rather than a memorised attribute.
 *
 * Azure fails somewhere else, so its rubric is genuinely different rather
 * than the same one translated. There the alert and its recipients are two
 * resources, and an action group with no receiver in it is valid, deploys
 * cleanly, satisfies every reference, and delivers to nobody.
 */

const AZURE_ID = 'task_alert_reaches_somebody_azure_v1';
const GCP_ID = 'task_alert_survives_silence_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_obs', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_obs', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_monitor_action_group" "oncall" {
  name                = "oncall"
  resource_group_name = "rg-prod"
  short_name          = "oncall"

  email_receiver {
    name          = "platform"
    email_address = "platform@example.internal"
  }
}

resource "azurerm_monitor_metric_alert" "errors" {
  name                = "${azureParams.token}"
  resource_group_name = "rg-prod"
  scopes              = [azurerm_linux_web_app.api.id]
  window_size         = "PT5M"
  frequency           = "PT1M"
  severity            = 1

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 10
  }

  action {
    action_group_id = azurerm_monitor_action_group.oncall.id
  }
}
`;

const GCP_PASSING = `
resource "google_monitoring_notification_channel" "oncall" {
  display_name = "Platform on-call"
  type         = "email"

  labels = {
    email_address = "platform@example.internal"
  }
}

resource "google_monitoring_alert_policy" "errors" {
  display_name = "${gcpParams.token}"
  combiner     = "OR"

  notification_channels = [google_monitoring_notification_channel.oncall.id]

  conditions {
    display_name = "Request errors climbing"

    condition_threshold {
      filter                 = "metric.type=\\"run.googleapis.com/request_count\\""
      comparison             = "COMPARISON_GT"
      threshold_value        = 10
      duration               = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_ACTIVE"
    }
  }
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure alert reaches somebody', () => {
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
   * The one that carries the task. Everything is wired: the alert exists,
   * the action group exists, the reference resolves. It delivers to nobody.
   */
  it('fails an action group with no receiver in it', () => {
    const source = AZURE_PASSING.replace(/email_receiver \{[\s\S]*?\n {2}\}/, '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('somebody_is_actually_in_it');
  });

  it('accepts a webhook receiver instead of email', () => {
    // The task is about somebody being reachable, not about which channel.
    const source = AZURE_PASSING.replace(
      /email_receiver \{[\s\S]*?\n {2}\}/,
      `webhook_receiver {
    name        = "pager"
    service_uri = "https://pager.example.internal/hook"
  }`,
    );
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('somebody_is_actually_in_it');
  });

  it('fails an alert that references no action group', () => {
    const source = AZURE_PASSING.replace(/action \{[\s\S]*?\n {2}\}/, '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('alert_is_wired_to_it');
  });

  it('fails a one-minute window that pages on a single blip', () => {
    const source = AZURE_PASSING.replace(
      'window_size         = "PT5M"',
      'window_size         = "PT1M"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('window_covers_more_than_a_blip');
  });

  it('accepts an hour-long window', () => {
    // Proves the duration reader handles the hour spelling rather than only
    // recognising minutes.
    const source = AZURE_PASSING.replace(
      'window_size         = "PT5M"',
      'window_size         = "PT1H"',
    );
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('window_covers_more_than_a_blip');
  });

  it('fails a window nobody can read rather than guessing at it', () => {
    // Fail closed. A guess here would pass a submission on a window that
    // does not mean anything.
    const source = AZURE_PASSING.replace(
      'window_size         = "PT5M"',
      'window_size         = "5 minutes"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('window_covers_more_than_a_blip');
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

describe('GCP alert survives silence', () => {
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
   * The same failure CloudWatch's default produces, under a different
   * attribute name. This is the row that makes the pair worth having.
   */
  it('fails a policy that ignores the service going quiet', () => {
    const source = GCP_PASSING.replace(
      'evaluation_missing_data = "EVALUATION_MISSING_DATA_ACTIVE"',
      '',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('no_data_still_fires');
  });

  it('does not accept the NO_OP setting written out explicitly', () => {
    // Writing the default by hand is not the same as deciding against it.
    const source = GCP_PASSING.replace(
      'EVALUATION_MISSING_DATA_ACTIVE',
      'EVALUATION_MISSING_DATA_NO_OP',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('no_data_still_fires');
  });

  it('fails a policy that notifies nobody', () => {
    const source = GCP_PASSING.replace(
      'notification_channels = [google_monitoring_notification_channel.oncall.id]',
      'notification_channels = []',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('policy_is_wired_to_it');
  });

  it('fails a zero duration that opens an incident on one sample', () => {
    const source = GCP_PASSING.replace(
      'duration               = "300s"',
      'duration               = "0s"',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('condition_holds_not_spikes');
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
