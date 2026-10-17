import { describe, expect, it } from 'vitest';
import { deriveTaskParams, gradeSubmission, taskById } from '../src/domain/graded-task-service';

/**
 * The third pair written to ADR 0004's step one, on failure_handling.
 *
 * All three providers end the same way - work disappears and nothing says so
 * - and each arrives there by a route the other two do not have.
 *
 * SQS has no dead-letter queue until you build one. Service Bus always has
 * one, which is the subtler problem: because it is always there, people
 * assume everything that fails reaches it, and expiry does not. A message
 * that outlives its TTL is deleted outright unless a flag that defaults to
 * false says otherwise.
 *
 * Pub/Sub has the sharpest version. A dead-letter topic is a topic, and
 * topics store nothing. Point a policy at one with no subscription attached
 * and every failed message is accepted, counted as dead-lettered, and
 * discarded, while the policy, the reference and the metrics all read as
 * correct. That is worse than having no policy at all, which at least keeps
 * redelivering until somebody notices.
 */

const AZURE_ID = 'task_queue_loses_nothing_azure_v1';
const GCP_ID = 'task_dead_letter_actually_keeps_gcp_v1';

const azureParams = deriveTaskParams('cand_azure_fail', AZURE_ID);
const gcpParams = deriveTaskParams('cand_gcp_fail', GCP_ID);

const AZURE_PASSING = `
resource "azurerm_servicebus_queue" "orders" {
  name         = "${azureParams.token}"
  namespace_id = azurerm_servicebus_namespace.main.id

  max_delivery_count                      = 5
  default_message_ttl                     = "P7D"
  dead_lettering_on_message_expiration    = true
  lock_duration                           = "PT1M"
}
`;

const GCP_PASSING = `
resource "google_pubsub_topic" "events" {
  name = "events"
}

resource "google_pubsub_topic" "events_dead" {
  name = "events-dead"
}

resource "google_pubsub_subscription" "worker" {
  name  = "${gcpParams.token}"
  topic = google_pubsub_topic.events.name

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.events_dead.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

resource "google_pubsub_subscription" "dead_reader" {
  name  = "events-dead-reader"
  topic = google_pubsub_topic.events_dead.name
}
`;

function failed(taskId: string, source: string, params: ReturnType<typeof deriveTaskParams>) {
  const task = taskById(taskId)!;
  return gradeSubmission(task, source, params)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe('Azure queue loses nothing', () => {
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
   * The one the task exists for. Service Bus has a dead-letter subqueue
   * whether or not this flag is set, so the submission looks complete.
   */
  it('fails a TTL that deletes rather than dead-letters', () => {
    const source = AZURE_PASSING.replace(
      'dead_lettering_on_message_expiration    = true',
      'dead_lettering_on_message_expiration    = false',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('expiry_is_not_deletion');
  });

  it('fails when the flag is simply absent, which is the same thing', () => {
    const source = AZURE_PASSING.replace('dead_lettering_on_message_expiration    = true', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('expiry_is_not_deletion');
  });

  it('fails a queue with no message lifetime', () => {
    const source = AZURE_PASSING.replace('default_message_ttl                     = "P7D"', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('messages_expire');
  });

  it('fails unbounded retrying', () => {
    const source = AZURE_PASSING.replace('max_delivery_count                      = 5', '');
    expect(failed(AZURE_ID, source, azureParams)).toContain('bounded_retries');
  });

  it('fails a lock shorter than the work the brief describes', () => {
    // Thirty seconds of work under a ten second lock is the same message
    // processed twice, and both attempts count toward the delivery limit.
    const source = AZURE_PASSING.replace(
      'lock_duration                           = "PT1M"',
      'lock_duration                           = "PT10S"',
    );
    expect(failed(AZURE_ID, source, azureParams)).toContain('lock_outlasts_the_work');
  });

  it('accepts a lock stated in seconds rather than minutes', () => {
    // Proves the duration reader handles the seconds spelling, which Service
    // Bus uses far more than Monitor does.
    const source = AZURE_PASSING.replace(
      'lock_duration                           = "PT1M"',
      'lock_duration                           = "PT45S"',
    );
    expect(failed(AZURE_ID, source, azureParams)).not.toContain('lock_outlasts_the_work');
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

describe('GCP dead letter actually keeps', () => {
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
   * The check the whole task is built around, and the reason this pair was
   * worth writing rather than translating the SQS task.
   *
   * Everything here is right except that nothing reads the dead-letter
   * topic. The policy is set, the topic exists, the reference resolves, and
   * every failed message is destroyed.
   */
  it('fails a dead-letter topic that nothing subscribes to', () => {
    const source = GCP_PASSING.replace(
      /resource "google_pubsub_subscription" "dead_reader" \{[\s\S]*?\n\}/,
      '',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('dead_letter_topic_is_read');
  });

  it('is not fooled by a second subscription on the wrong topic', () => {
    // A subscription exists, but it reads the main topic again rather than
    // the dead-letter one. Counting subscriptions would pass this.
    const source = GCP_PASSING.replace(
      'name  = "events-dead-reader"\n  topic = google_pubsub_topic.events_dead.name',
      'name  = "events-second-worker"\n  topic = google_pubsub_topic.events.name',
    );
    expect(failed(GCP_ID, source, gcpParams)).toContain('dead_letter_topic_is_read');
  });

  it('fails a subscription with no dead-letter policy at all', () => {
    const source = GCP_PASSING.replace(/dead_letter_policy \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('dead_letter_policy');
  });

  it('fails a policy that never hands anything over', () => {
    const source = GCP_PASSING.replace('max_delivery_attempts = 5', '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('bounded_attempts');
  });

  it('fails an immediate retry loop', () => {
    const source = GCP_PASSING.replace(/retry_policy \{[\s\S]*?\n {2}\}/, '');
    expect(failed(GCP_ID, source, gcpParams)).toContain('backs_off_between_tries');
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
