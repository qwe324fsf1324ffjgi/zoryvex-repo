import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRACK_CAPABILITIES } from '@zoryvex/contracts';
import {
  GRADED_TASKS,
  deriveTaskParams,
  gradeSubmission,
  gradedTaskDetail,
  isPinnedImage,
  taskById,
  taskForTrack,
  tasksForTrack,
} from '../src/domain/graded-task-service';
import { MAX_SUBMISSION_BYTES } from '../src/lib/hcl';

const CANDIDATE = 'cand_under_test';

/** Each task is personalised, so every fixture is written for one candidate. */
const paramsFor = (taskId: string) => deriveTaskParams(CANDIDATE, taskId);

const s3Task = taskById('task_s3_lockdown_v1')!;
const roleTask = taskById('task_least_privilege_role_v1')!;
const platformTask = taskById('task_platform_hygiene_v1')!;

/** A submission that does the job, as somebody who knows the work would write it. */
const GOOD_S3 = `
resource "aws_s3_bucket" "documents" {
  bucket = "${paramsFor('task_s3_lockdown_v1').token}"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Statement = [{
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = "arn:aws:s3:::identity-documents/*"
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
`;

const GOOD_ROLE = `
resource "aws_iam_role" "fn" {
  name = "${paramsFor('task_least_privilege_role_v1').token}"
  assume_role_policy = jsonencode({
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "fn" {
  role = aws_iam_role.fn.id
  policy = jsonencode({
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::evidence/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/lambda/worker:*"
      }
    ]
  })
}
`;

const GOOD_PLATFORM = `
resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/worker"
  retention_in_days = ${paramsFor('task_platform_hygiene_v1').retentionDays}
}

resource "aws_lambda_function" "fn" {
  function_name                  = "${paramsFor('task_platform_hygiene_v1').token}"
  role                           = aws_iam_role.fn.arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  timeout                        = 30
  reserved_concurrent_executions = 5
}
`;

describe('task catalogue', () => {
  it('offers a task for each track it can grade well', () => {
    expect(taskForTrack('cloud_security')?.id).toBe('task_s3_lockdown_v1');
    expect(taskForTrack('aws_cloud')?.id).toBe('task_least_privilege_role_v1');
    expect(taskForTrack('devops_platform')?.id).toBe('task_platform_hygiene_v1');
  });

  it('now covers every launch track', () => {
    expect(taskForTrack('mlops')?.id).toBe('task_model_serving_v1');
  });

  it('still returns nothing for an id that does not exist', () => {
    // The null path stays: a future track ships without a task until one is
    // worth publishing, because a rubric that does not discriminate puts the
    // platform's name on a result that means nothing.
    expect(taskById('task_invented')).toBeNull();
  });

  it('keeps every task inside an hour', () => {
    // A verification costing forty hours has moved the problem, not solved
    // it. That is the complaint the task exists to answer.
    for (const task of GRADED_TASKS) {
      expect(task.timeboxMinutes, task.id).toBeLessThanOrEqual(60);
    }
  });

  it('gives every check a requirement, a miss, and a reason it matters', () => {
    // CLAUDE.md forbids a silent rejection. A candidate who fails must learn
    // something true about the work.
    for (const task of GRADED_TASKS) {
      for (const check of task.checks) {
        expect(check.requirement.length, `${task.id}/${check.id}`).toBeGreaterThan(0);
        expect(check.missing.length, `${task.id}/${check.id}`).toBeGreaterThan(0);
        expect(check.matters.length, `${task.id}/${check.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('tells every candidate the name their brief expects', () => {
    // The identity gate gives a submission its owner. A brief that forgets
    // to state the name fails everyone who attempts that task, and reads to
    // them as the platform saying they cheated.
    for (const task of GRADED_TASKS) {
      const params = deriveTaskParams(CANDIDATE, task.id);
      expect(task.brief(params).join(' '), task.id).toContain(params.token);
    }
  });

  it('gives a different candidate a different name to use', () => {
    // Personalisation is the whole reason the identity gate can mean
    // anything. Two candidates deriving the same token would make a copied
    // submission indistinguishable from an original one.
    for (const task of GRADED_TASKS) {
      const mine = deriveTaskParams(CANDIDATE, task.id);
      const theirs = deriveTaskParams('somebody_else', task.id);
      expect(theirs.token, task.id).not.toBe(mine.token);
    }
  });

  it('keeps check ids unique within a task', () => {
    // Two checks sharing an id collapse into one row in the result, so a
    // candidate is told about one of the two things they missed.
    for (const task of GRADED_TASKS) {
      const ids = task.checks.map((c) => c.id);
      expect(new Set(ids).size, `${task.id} has a duplicate check id`).toBe(ids.length);
    }
  });

  it('sets a pass mark below full marks, but well above half', () => {
    for (const task of GRADED_TASKS) {
      expect(task.passMark).toBeLessThan(task.checks.length);
      expect(task.passMark).toBeGreaterThan(task.checks.length / 2);
    }
  });
});

describe('grading a competent submission', () => {
  it('passes the bucket lockdown on every check', () => {
    const result = gradeSubmission(s3Task, GOOD_S3, paramsFor(s3Task.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(result.outOf);
  });

  it('passes the least-privilege role on every check', () => {
    const result = gradeSubmission(roleTask, GOOD_ROLE, paramsFor(roleTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('passes the platform task on every check', () => {
    const result = gradeSubmission(platformTask, GOOD_PLATFORM, paramsFor(platformTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe('grading catches the mistakes the task is about', () => {
  it('catches three of four public-access settings, the classic miss', () => {
    // This is the single most common cause of a leaked bucket, and the
    // reason the check tests all four rather than the resource's presence.
    const threeOfFour = GOOD_S3.replace(
      'restrict_public_buckets = true',
      'restrict_public_buckets = false',
    );
    const result = gradeSubmission(s3Task, threeOfFour, paramsFor(s3Task.id));
    const failed = result.checks.find((c) => c.id === 'public_access_block');
    expect(failed?.passed).toBe(false);
    expect(failed?.missing).toContain('restrict_public_buckets');
  });

  it('catches encryption at rest without TLS in transit', () => {
    const noTls = GOOD_S3.replace(/resource "aws_s3_bucket_policy"[\s\S]*$/, '');
    const result = gradeSubmission(s3Task, noTls, paramsFor(s3Task.id));
    expect(result.checks.find((c) => c.id === 'tls_only')?.passed).toBe(false);
    // Encryption still passes, so the feedback is specific rather than a
    // blanket "insecure".
    expect(result.checks.find((c) => c.id === 'encryption')?.passed).toBe(true);
  });

  it('catches versioning that was configured but not enabled', () => {
    const suspended = GOOD_S3.replace('status = "Enabled"', 'status = "Suspended"');
    expect(
      gradeSubmission(s3Task, suspended, paramsFor(s3Task.id)).checks.find(
        (c) => c.id === 'versioning',
      )?.passed,
    ).toBe(false);
  });

  it('catches a wildcard action in a policy', () => {
    const wildcard = GOOD_ROLE.replace('["s3:GetObject", "s3:PutObject"]', '"s3:*"');
    const result = gradeSubmission(roleTask, wildcard, paramsFor(roleTask.id));
    expect(result.checks.find((c) => c.id === 'no_wildcard_action')?.passed).toBe(false);
  });

  it('catches a bare star resource', () => {
    const star = GOOD_ROLE.replace('"arn:aws:s3:::evidence/*"', '"*"');
    expect(
      gradeSubmission(roleTask, star, paramsFor(roleTask.id)).checks.find(
        (c) => c.id === 'scoped_resources',
      )?.passed,
    ).toBe(false);
  });

  it('accepts a log-group ARN ending in a star, which is normal', () => {
    // The check must not punish conventional log scoping while catching the
    // unqualified star. Getting this wrong would fail competent people.
    expect(
      gradeSubmission(roleTask, GOOD_ROLE, paramsFor(roleTask.id)).checks.find(
        (c) => c.id === 'scoped_resources',
      )?.passed,
    ).toBe(true);
  });

  it('catches a function with no concurrency bound', () => {
    const unbounded = GOOD_PLATFORM.replace('reserved_concurrent_executions = 5', '');
    expect(
      gradeSubmission(platformTask, unbounded, paramsFor(platformTask.id)).checks.find(
        (c) => c.id === 'concurrency',
      )?.passed,
    ).toBe(false);
  });

  it('catches a log group with no retention', () => {
    const forever = GOOD_PLATFORM.replace(/retention_in_days = \d+/, '');
    expect(
      gradeSubmission(platformTask, forever, paramsFor(platformTask.id)).checks.find(
        (c) => c.id === 'retention',
      )?.passed,
    ).toBe(false);
  });
});

describe('grading is fair and safe', () => {
  it('is deterministic: the same text scores the same, every time', () => {
    // The property that makes this verification rather than an opinion.
    const runs = Array.from({ length: 5 }, () =>
      gradeSubmission(s3Task, GOOD_S3, paramsFor(s3Task.id)),
    );
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it('fails an empty submission without crediting anything', () => {
    const result = gradeSubmission(s3Task, '', paramsFor(s3Task.id));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('tells a failing candidate exactly what was missing and why', () => {
    const result = gradeSubmission(
      s3Task,
      'resource "aws_s3_bucket" "b" { bucket = "x" }',
      paramsFor(s3Task.id),
    );
    expect(result.passed).toBe(false);
    for (const check of result.checks.filter((c) => !c.passed)) {
      expect(check.missing, check.id).toBeTruthy();
      expect(check.matters, check.id).toBeTruthy();
    }
    // And credits what they did do.
    expect(result.checks.find((c) => c.id === 'bucket')?.passed).toBe(true);
  });

  it('refuses an oversized submission instead of grading it', () => {
    const result = gradeSubmission(
      s3Task,
      'x'.repeat(MAX_SUBMISSION_BYTES + 1),
      paramsFor(s3Task.id),
    );
    expect(result.refused).toBeTruthy();
    expect(result.passed).toBe(false);
  });

  it('survives adversarial input without throwing or hanging', () => {
    for (const nasty of ['{'.repeat(9000), '"'.repeat(9000), '='.repeat(9000), ' ']) {
      const started = Date.now();
      expect(() => gradeSubmission(s3Task, nasty, paramsFor(s3Task.id))).not.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });

  it('describes a pass in words an employer can read', () => {
    const result = gradeSubmission(s3Task, GOOD_S3, paramsFor(s3Task.id));
    const detail = gradedTaskDetail(s3Task, result);
    expect(detail).toContain(s3Task.title);
    expect(detail).toContain('published rubric');
  });
});

const mlopsTask = taskById('task_model_serving_v1')!;

const GOOD_MODEL_SERVING = `
resource "aws_sagemaker_model" "ranker" {
  name               = "${paramsFor('task_model_serving_v1').token}"
  execution_role_arn = aws_iam_role.sagemaker.arn

  primary_container {
    image          = "111122223333.dkr.ecr.eu-west-1.amazonaws.com/ranker:2.4.1"
    model_data_url = "s3://models/ranker/2.4.1/model.tar.gz"
  }
}

resource "aws_sagemaker_endpoint_configuration" "ranker" {
  name = "ranker"

  production_variants {
    variant_name           = "primary"
    model_name             = aws_sagemaker_model.ranker.name
    initial_instance_count = 1
    instance_type          = "ml.m5.large"
  }

  data_capture_config {
    enable_capture              = true
    initial_sampling_percentage = 20
    destination_s3_uri          = "s3://model-capture/ranker"
  }
}

resource "aws_sagemaker_endpoint" "ranker" {
  name                 = "ranker"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.ranker.name
}

resource "aws_appautoscaling_target" "ranker" {
  service_namespace  = "sagemaker"
  resource_id        = "endpoint/ranker/variant/primary"
  scalable_dimension = "sagemaker:variant:DesiredInstanceCount"
  min_capacity       = 1
  max_capacity       = 4
}
`;

describe('the MLOps task', () => {
  it('passes a submission that serves a model properly', () => {
    const result = gradeSubmission(mlopsTask, GOOD_MODEL_SERVING, paramsFor(mlopsTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The two checks that actually separate somebody who has run a model in
   * production from somebody who has deployed one. Generic cloud competence
   * gets the model, the endpoint and the autoscaling; it misses these.
   */
  it('catches an image tagged :latest', () => {
    const latest = GOOD_MODEL_SERVING.replace('/ranker:2.4.1"', '/ranker:latest"');
    const result = gradeSubmission(mlopsTask, latest, paramsFor(mlopsTask.id));
    const failed = result.checks.find((c) => c.id === 'pinned_image');
    expect(failed?.passed).toBe(false);
    expect(failed?.matters).toContain('Reproducibility');
  });

  it('catches an untagged image, which resolves to :latest anyway', () => {
    const untagged = GOOD_MODEL_SERVING.replace('/ranker:2.4.1"', '/ranker"');
    expect(
      gradeSubmission(mlopsTask, untagged, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'pinned_image',
      )?.passed,
    ).toBe(false);
  });

  it('accepts a digest, which is the strongest pin', () => {
    const digest = GOOD_MODEL_SERVING.replace(
      '/ranker:2.4.1"',
      '/ranker@sha256:9f2c4a1e9f2c4a1e9f2c4a1e9f2c4a1e9f2c4a1e9f2c4a1e9f2c4a1e9f2c4a1e"',
    );
    expect(
      gradeSubmission(mlopsTask, digest, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'pinned_image',
      )?.passed,
    ).toBe(true);
  });

  it('catches a missing data capture config', () => {
    // Without captured requests you cannot tell a model has drifted, only
    // that something downstream got worse.
    const noCapture = GOOD_MODEL_SERVING.replace(/data_capture_config \{[\s\S]*?\n {2}\}/, '');
    const result = gradeSubmission(mlopsTask, noCapture, paramsFor(mlopsTask.id));
    expect(result.checks.find((c) => c.id === 'data_capture')?.passed).toBe(false);
    // The rest still passes, so the feedback stays specific.
    expect(result.checks.find((c) => c.id === 'endpoint')?.passed).toBe(true);
  });

  it('catches data capture that was configured but switched off', () => {
    const off = GOOD_MODEL_SERVING.replace(
      'enable_capture              = true',
      'enable_capture = false',
    );
    expect(
      gradeSubmission(mlopsTask, off, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'data_capture',
      )?.passed,
    ).toBe(false);
  });

  it('catches a fixed-capacity endpoint', () => {
    const fixed = GOOD_MODEL_SERVING.replace(/resource "aws_appautoscaling_target"[\s\S]*$/, '');
    expect(
      gradeSubmission(mlopsTask, fixed, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'autoscaling',
      )?.passed,
    ).toBe(false);
  });

  it('does not credit autoscaling that belongs to something else', () => {
    const wrongService = GOOD_MODEL_SERVING.replace('"sagemaker"', '"ecs"');
    expect(
      gradeSubmission(mlopsTask, wrongService, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'autoscaling',
      )?.passed,
    ).toBe(false);
  });

  it('fails an image it cannot read, because pinning must be visible', () => {
    // The brief asks for the URI written out for exactly this reason: an
    // image behind a variable cannot be inspected, so it cannot be credited.
    const viaVariable = GOOD_MODEL_SERVING.replace(
      '"111122223333.dkr.ecr.eu-west-1.amazonaws.com/ranker:2.4.1"',
      'var.model_image',
    );
    expect(
      gradeSubmission(mlopsTask, viaVariable, paramsFor(mlopsTask.id)).checks.find(
        (c) => c.id === 'pinned_image',
      )?.passed,
    ).toBe(false);
  });
});

describe('isPinnedImage', () => {
  it.each([
    ['acct.dkr.ecr.eu-west-1.amazonaws.com/m:1.0.0', true],
    ['acct.dkr.ecr.eu-west-1.amazonaws.com/m@sha256:abc123', true],
    ['acct.dkr.ecr.eu-west-1.amazonaws.com/m:latest', false],
    ['acct.dkr.ecr.eu-west-1.amazonaws.com/m:LATEST', false],
    ['acct.dkr.ecr.eu-west-1.amazonaws.com/m', false],
    ['', false],
  ])('%s -> %s', (image, expected) => {
    expect(isPinnedImage(image)).toBe(expected);
  });
});

const featureTask = taskById('task_feature_path_v1')!;

const GOOD_FEATURE_PATH = `
resource "aws_sagemaker_feature_group" "customer" {
  feature_group_name             = "${paramsFor('task_feature_path_v1').token}"
  record_identifier_feature_name = "customer_id"
  event_time_feature_name        = "recorded_at"
  role_arn                       = aws_iam_role.feature_store.arn

  feature_definition {
    feature_name = "customer_id"
    feature_type = "String"
  }

  feature_definition {
    feature_name = "orders_last_30d"
    feature_type = "Integral"
  }

  online_store_config {
    enable_online_store = true
  }

  offline_store_config {
    s3_storage_config {
      s3_uri = "s3://features/customer"
    }
  }
}
`;

describe('the feature-path task', () => {
  it('passes a submission that gets the whole path right', () => {
    const result = gradeSubmission(featureTask, GOOD_FEATURE_PATH, paramsFor(featureTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The check that decides whether the model is honest. Without an event
   * time there is no way to assemble a training example as it stood at a
   * past moment, so training silently sees data from after the prediction it
   * is learning to make.
   */
  it('catches a missing event time, the leakage check', () => {
    const noEventTime = GOOD_FEATURE_PATH.replace(/ {2}event_time_feature_name.*\n/, '');
    const result = gradeSubmission(featureTask, noEventTime, paramsFor(featureTask.id));
    const failed = result.checks.find((c) => c.id === 'event_time');
    expect(failed?.passed).toBe(false);
    expect(failed?.matters).toContain('after the prediction');
  });

  it('catches a store that only serves, with no history to retrain from', () => {
    const onlineOnly = GOOD_FEATURE_PATH.replace(
      / {2}offline_store_config \{[\s\S]*?\n {2}\}\n/,
      '',
    );
    const result = gradeSubmission(featureTask, onlineOnly, paramsFor(featureTask.id));
    expect(result.checks.find((c) => c.id === 'offline_store')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'online_store')?.passed).toBe(true);
  });

  it('catches an online store that was configured but switched off', () => {
    const off = GOOD_FEATURE_PATH.replace(
      'enable_online_store = true',
      'enable_online_store = false',
    );
    expect(
      gradeSubmission(featureTask, off, paramsFor(featureTask.id)).checks.find(
        (c) => c.id === 'online_store',
      )?.passed,
    ).toBe(false);
  });

  it('catches a missing record identifier', () => {
    const noId = GOOD_FEATURE_PATH.replace(/ {2}record_identifier_feature_name.*\n/, '');
    expect(
      gradeSubmission(featureTask, noId, paramsFor(featureTask.id)).checks.find(
        (c) => c.id === 'record_identifier',
      )?.passed,
    ).toBe(false);
  });

  it('does not accept a single feature definition as a feature path', () => {
    const oneFeature = GOOD_FEATURE_PATH.replace(
      / {2}feature_definition \{\n {4}feature_name = "orders_last_30d"[\s\S]*?\n {2}\}\n/,
      '',
    );
    expect(
      gradeSubmission(featureTask, oneFeature, paramsFor(featureTask.id)).checks.find(
        (c) => c.id === 'feature_group',
      )?.passed,
    ).toBe(false);
  });
});

describe('a track can offer more than one task', () => {
  /**
   * This asserted the exact nine MLOps tasks and an empty tail, which was
   * right while a track's tasks were the ones filed under its title. Since
   * the capability layer, availability comes from what a task demonstrates
   * and MLOps reaches twenty-one — it needs network isolation, failure
   * handling and cost control, and tasks written for other roles prove those.
   *
   * The intent is unchanged and still checked: every MLOps task is offered,
   * in order, rather than only the first. What is new is the tail, and that
   * it is a tail rather than interleaved.
   */
  const MLOPS_OWN_TASKS = [
    'task_model_serving_v1',
    'task_feature_path_v1',
    'task_model_monitoring_v1',
    'task_model_governance_v1',
    'task_training_run_v1',
    'task_async_inference_v1',
    'task_safe_rollout_v1',
    'task_retraining_loop_v1',
    'task_model_workbench_v1',
  ];

  it('offers every MLOps task, in order, ahead of anything it borrows', () => {
    const ids = tasksForTrack('mlops').map((t) => t.id);
    expect(ids.slice(0, MLOPS_OWN_TASKS.length)).toEqual(MLOPS_OWN_TASKS);
  });

  /**
   * The same property on every track, because a user-visible sentence now
   * depends on it.
   *
   * The task chooser tells a candidate "the ones written for your track are
   * first". That is a claim about this ordering, made on a page where a
   * candidate picks one task out of as many as 37, and it is the only signal
   * they get about which end of the list is most relevant to them. If the
   * order ever stopped holding, the copy would quietly become a lie rather
   * than break anything, so it is pinned here rather than left to the MLOps
   * case above.
   */
  it('puts every track’s own tasks ahead of the ones it borrows', () => {
    for (const track of ['aws_cloud', 'devops_platform', 'cloud_security', 'mlops'] as const) {
      const offered = tasksForTrack(track);
      const firstBorrowed = offered.findIndex((task) => task.track !== track);
      if (firstBorrowed === -1) continue;
      // Named rather than counted, so a failure says which tasks slipped past
      // the borrowed ones instead of reporting two indexes.
      const ownAfterBorrowed = offered
        .slice(firstBorrowed)
        .filter((task) => task.track === track)
        .map((task) => task.id);
      expect(ownAfterBorrowed, `${track} lists its own tasks after borrowed ones`).toEqual([]);
    }
  });

  it('also reaches tasks written for other roles that prove what MLOps needs', () => {
    const ids = tasksForTrack('mlops').map((t) => t.id);
    expect(ids.length).toBeGreaterThan(MLOPS_OWN_TASKS.length);
    // Borrowed rather than arbitrary: each one demonstrates a capability
    // MLOps actually declares.
    const borrowed = tasksForTrack('mlops').filter((t) => t.track !== 'mlops');
    for (const task of borrowed) {
      expect(
        task.capabilities.some((c) => TRACK_CAPABILITIES.mlops.includes(c)),
        `${task.id} is offered to MLOps but proves nothing it needs`,
      ).toBe(true);
    }
  });

  it('keeps the tasks on every track about genuinely different failures', () => {
    // Two tasks offered side by side that check the same things are a choice
    // in name only. Serving badly costs money and goes unnoticed; getting the
    // feature path wrong makes the model quietly wrong; monitoring is about
    // nobody noticing either. Every pair is compared, not just one, so a third
    // task cannot quietly duplicate a second.
    //
    // Widened from MLOps to all four tracks on 2026-09-05. The property was
    // always meant to hold everywhere and scoping it to one track was history
    // rather than intent. It earned the widening immediately, twice.
    //
    // Expect to trip this when adding a task for a provider that already has
    // one, and read the failure carefully before renaming anything. The
    // multi-cloud tasks are deliberately parallel in concept - that is ADR
    // 0004's whole thesis, that the same failure wears a different name on
    // each provider - so a shared check id there means the id was inaccurate,
    // not that the work was duplicated. Both collisions found on 2026-09-05
    // were that: the alerting pair read treat_missing_data on CloudWatch and
    // evaluation_missing_data on GCP, and window_size on Azure against
    // datapoints_to_alarm on AWS. Different attributes, different resources,
    // and the ids now say so.
    //
    // What this still catches, and must keep catching, is two tasks on the
    // same provider that ask the same question twice. That is a choice in
    // name only, and it is the thing worth failing a build over.
    for (const track of ['aws_cloud', 'devops_platform', 'cloud_security', 'mlops'] as const) {
      const all = tasksForTrack(track);
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          const a = all[i]!.checks.map((c) => c.id);
          const b = all[j]!.checks.map((c) => c.id);
          expect(
            a.filter((id) => b.includes(id)),
            `${track}: ${all[i]!.id} vs ${all[j]!.id}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('offers a real choice on every track, not a single take-it-or-leave-it task', () => {
    // This replaced an assertion that the thinner tracks returned exactly one
    // task. Every track carries several now, and the property worth holding
    // is the one the product depends on: somebody whose best work does not
    // suit the first task has another they can prove themselves with.
    for (const track of ['aws_cloud', 'devops_platform', 'cloud_security', 'mlops'] as const) {
      expect(tasksForTrack(track).length, track).toBeGreaterThan(1);
    }
  });

  it('every task id is unique, so a submission is never graded by the wrong rubric', () => {
    const ids = GRADED_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Personalisation exists because the rubric is published on purpose, so
 * nothing about a task is secret and a passing submission can be shared.
 * Multiple variants raise the cost of copying without fixing it. Naming
 * fixes it: a copied answer arrives carrying somebody else's name.
 */
describe('per-candidate parameters', () => {
  const OTHER = 'cand_someone_else';

  it('gives the same candidate the same assignment every time', () => {
    // Stability matters more than surprise. It means nobody can re-roll for
    // an easier task, a half-finished attempt is still valid tomorrow, and
    // grading stays reproducible.
    const a = deriveTaskParams(CANDIDATE, s3Task.id);
    const b = deriveTaskParams(CANDIDATE, s3Task.id);
    expect(a).toEqual(b);
  });

  it('gives different candidates different assignments', () => {
    expect(deriveTaskParams(CANDIDATE, s3Task.id).token).not.toBe(
      deriveTaskParams(OTHER, s3Task.id).token,
    );
  });

  it('gives the same candidate different assignments per task', () => {
    expect(deriveTaskParams(CANDIDATE, s3Task.id).token).not.toBe(
      deriveTaskParams(CANDIDATE, roleTask.id).token,
    );
  });

  it('puts the name in the brief, so nobody has to guess it', () => {
    const params = paramsFor(s3Task.id);
    expect(s3Task.brief(params).join(' ')).toContain(params.token);
  });

  it('puts a personal number in the brief where the task uses one', () => {
    const params = paramsFor(platformTask.id);
    expect(platformTask.brief(params).join(' ')).toContain(String(params.retentionDays));
  });

  /**
   * The trap this design had to avoid. The pass mark allows one miss, so if
   * the name were simply another scored check, a borrowed submission would
   * fail that one check and still score enough to pass. The gate sits
   * outside the score for exactly this reason.
   */
  it('fails a copied submission even though it is otherwise perfect', () => {
    const theirs = gradeSubmission(s3Task, GOOD_S3, paramsFor(s3Task.id));
    expect(theirs.passed).toBe(true);
    expect(theirs.score).toBe(theirs.outOf);

    // The same flawless answer, graded for somebody else.
    const copied = gradeSubmission(s3Task, GOOD_S3, deriveTaskParams(OTHER, s3Task.id));
    expect(copied.score).toBe(copied.outOf); // every requirement still met
    expect(copied.score).toBeGreaterThanOrEqual(copied.passMark);
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false); // and it still does not pass
  });

  it('says the name is wrong rather than handing back a score', () => {
    // Somebody who did good work under the wrong name needs to be told that,
    // not marked down for work they actually did.
    const copied = gradeSubmission(s3Task, GOOD_S3, deriveTaskParams(OTHER, s3Task.id));
    expect(copied.identityMissing).toContain('your brief');
  });

  it('catches a copied answer on every task, not just one', () => {
    const cases: Array<[typeof s3Task, string]> = [
      [s3Task, GOOD_S3],
      [roleTask, GOOD_ROLE],
      [platformTask, GOOD_PLATFORM],
      [mlopsTask, GOOD_MODEL_SERVING],
      [featureTask, GOOD_FEATURE_PATH],
    ];
    for (const [task, submission] of cases) {
      expect(gradeSubmission(task, submission, paramsFor(task.id)).passed, task.id).toBe(true);
      expect(
        gradeSubmission(task, submission, deriveTaskParams(OTHER, task.id)).passed,
        task.id,
      ).toBe(false);
    }
  });

  it('catches a copied retention value, not only a copied name', () => {
    // The platform task carries a personal number as well as a name, so
    // renaming alone does not launder a borrowed answer.
    const other = deriveTaskParams(OTHER, platformTask.id);
    const renamedOnly = GOOD_PLATFORM.replace(paramsFor(platformTask.id).token, other.token);
    const result = gradeSubmission(platformTask, renamedOnly, other);
    // The retention is still the original candidate's, unless they collide.
    if (paramsFor(platformTask.id).retentionDays !== other.retentionDays) {
      expect(result.identityOk).toBe(false);
    }
  });
});

const monitoringTask = taskById('task_model_monitoring_v1')!;

/** Written to the shapes in the AWS provider's own documentation. */
const GOOD_MONITORING = `
resource "aws_sagemaker_data_quality_job_definition" "drift" {
  name     = "drift"
  role_arn = aws_iam_role.monitor.arn

  data_quality_app_specification {
    image_uri = data.aws_sagemaker_prebuilt_ecr_image.monitor.registry_path
  }

  data_quality_job_input {
    endpoint_input {
      endpoint_name = aws_sagemaker_endpoint.ranker.name
    }
  }

  data_quality_job_output_config {
    monitoring_outputs {
      s3_output {
        s3_uri = "s3://model-monitoring/drift"
      }
    }
  }

  job_resources {
    cluster_config {
      instance_count    = 1
      instance_type     = "ml.t3.medium"
      volume_size_in_gb = 20
    }
  }
}

resource "aws_sagemaker_monitoring_schedule" "drift" {
  name = "${paramsFor('task_model_monitoring_v1').token}"

  monitoring_schedule_config {
    monitoring_job_definition_name = aws_sagemaker_data_quality_job_definition.drift.name
    monitoring_type                = "DataQuality"
  }
}
`;

describe('the model-monitoring task', () => {
  it('passes a submission that closes the loop', () => {
    const result = gradeSubmission(monitoringTask, GOOD_MONITORING, paramsFor(monitoringTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The half-measure this task exists to catch: a job definition that is
   * never scheduled. The capture box is ticked, the config exists, and the
   * comparison never runs.
   */
  it('catches a job definition nobody scheduled', () => {
    const unscheduled = GOOD_MONITORING.replace(
      /resource "aws_sagemaker_monitoring_schedule"[\s\S]*$/,
      '',
    );
    const result = gradeSubmission(monitoringTask, unscheduled, paramsFor(monitoringTask.id));
    expect(result.checks.find((c) => c.id === 'schedule')?.passed).toBe(false);
    // The job definition itself still passes, so the feedback is specific.
    expect(result.checks.find((c) => c.id === 'job_definition')?.passed).toBe(true);
  });

  it('catches findings that go nowhere durable', () => {
    const noOutput = GOOD_MONITORING.replace(
      / {2}data_quality_job_output_config \{[\s\S]*?\n {2}\}\n/,
      '',
    );
    expect(
      gradeSubmission(monitoringTask, noOutput, paramsFor(monitoringTask.id)).checks.find(
        (c) => c.id === 'findings_output',
      )?.passed,
    ).toBe(false);
  });

  it('catches a monitoring job with unbounded compute', () => {
    const noResources = GOOD_MONITORING.replace(/ {2}job_resources \{[\s\S]*?\n {2}\}\n/, '');
    expect(
      gradeSubmission(monitoringTask, noResources, paramsFor(monitoringTask.id)).checks.find(
        (c) => c.id === 'bounded_resources',
      )?.passed,
    ).toBe(false);
  });

  it('catches a job pointed at nothing live', () => {
    const noEndpoint = GOOD_MONITORING.replace(
      / {2}data_quality_job_input \{[\s\S]*?\n {2}\}\n/,
      '',
    );
    expect(
      gradeSubmission(monitoringTask, noEndpoint, paramsFor(monitoringTask.id)).checks.find(
        (c) => c.id === 'watches_endpoint',
      )?.passed,
    ).toBe(false);
  });

  it('catches a schedule not wired to a job definition', () => {
    const dangling = GOOD_MONITORING.replace(/ {4}monitoring_job_definition_name.*\n/, '');
    expect(
      gradeSubmission(monitoringTask, dangling, paramsFor(monitoringTask.id)).checks.find(
        (c) => c.id === 'schedule',
      )?.passed,
    ).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      monitoringTask,
      GOOD_MONITORING,
      deriveTaskParams('cand_someone_else', monitoringTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const governanceTask = taskById('task_model_governance_v1')!;

/** Written to the shapes in the AWS provider's own documentation. */
const GOOD_GOVERNANCE = `
data "aws_caller_identity" "current" {}

resource "aws_sagemaker_model_package_group" "models" {
  model_package_group_name = "${paramsFor('task_model_governance_v1').token}"
}

data "aws_iam_policy_document" "promote" {
  statement {
    sid     = "OnlyReleaseEngineersApprove"
    actions = ["sagemaker:UpdateModelPackage", "sagemaker:DescribeModelPackage"]
    resources = [aws_sagemaker_model_package_group.models.arn]
    principals {
      type        = "AWS"
      identifiers = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sagemaker_model_package_group_policy" "models" {
  model_package_group_name = aws_sagemaker_model_package_group.models.model_package_group_name
  resource_policy          = jsonencode(jsondecode(data.aws_iam_policy_document.promote.json))
}

resource "aws_sagemaker_model" "serving" {
  name               = "serving"
  execution_role_arn = aws_iam_role.sagemaker.arn

  primary_container {
    model_package_name = "arn:aws:sagemaker:eu-west-1:111122223333:model-package/ranker/7"
  }
}
`;

describe('the model-governance task', () => {
  it('passes a submission where production draws from a governed registry', () => {
    const result = gradeSubmission(governanceTask, GOOD_GOVERNANCE, paramsFor(governanceTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The check the whole task turns on. A registry nothing deploys from is a
   * filing cabinet: versions are recorded and production still serves
   * whatever somebody uploaded.
   */
  it('catches a registry that production does not actually serve from', () => {
    const rawImage = GOOD_GOVERNANCE.replace(
      '    model_package_name = "arn:aws:sagemaker:eu-west-1:111122223333:model-package/ranker/7"',
      '    image = "111122223333.dkr.ecr.eu-west-1.amazonaws.com/ranker:2.4.1"',
    );
    const result = gradeSubmission(governanceTask, rawImage, paramsFor(governanceTask.id));
    expect(result.checks.find((c) => c.id === 'served_from_registry')?.passed).toBe(false);
    // The registry itself still passes, so the feedback stays specific.
    expect(result.checks.find((c) => c.id === 'registry')?.passed).toBe(true);
  });

  it('catches a policy that governs reading but not promoting', () => {
    // Describe and List control who can look at the registry, not who can
    // promote from it.
    const readOnly = GOOD_GOVERNANCE.replace(
      '["sagemaker:UpdateModelPackage", "sagemaker:DescribeModelPackage"]',
      '["sagemaker:DescribeModelPackage", "sagemaker:ListModelPackages"]',
    );
    expect(
      gradeSubmission(governanceTask, readOnly, paramsFor(governanceTask.id)).checks.find(
        (c) => c.id === 'approval_action',
      )?.passed,
    ).toBe(false);
  });

  it('catches a registry with no policy at all', () => {
    const noPolicy = GOOD_GOVERNANCE.replace(
      /resource "aws_sagemaker_model_package_group_policy"[\s\S]*?\n\}\n/,
      '',
    );
    expect(
      gradeSubmission(governanceTask, noPolicy, paramsFor(governanceTask.id)).checks.find(
        (c) => c.id === 'registry_policy',
      )?.passed,
    ).toBe(false);
  });

  it('catches a policy that names nobody', () => {
    const openToAll = GOOD_GOVERNANCE.replace(/data "aws_caller_identity"[\s\S]*?\}\n/, '').replace(
      'identifiers = [data.aws_caller_identity.current.account_id]',
      'identifiers = ["*"]',
    );
    expect(
      gradeSubmission(governanceTask, openToAll, paramsFor(governanceTask.id)).checks.find(
        (c) => c.id === 'named_principal',
      )?.passed,
    ).toBe(false);
  });

  it('reads the policy wherever it was assembled, not only on the resource', () => {
    // A resource policy is almost always built in a separate
    // aws_iam_policy_document and referenced. Grading only the resource
    // would fail people for writing it the ordinary way.
    const result = gradeSubmission(governanceTask, GOOD_GOVERNANCE, paramsFor(governanceTask.id));
    expect(result.checks.find((c) => c.id === 'approval_action')?.passed).toBe(true);
    expect(result.checks.find((c) => c.id === 'named_principal')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      governanceTask,
      GOOD_GOVERNANCE,
      deriveTaskParams('cand_someone_else', governanceTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const trainingTask = taskById('task_training_run_v1')!;

/** Written to the shape in the AWS provider's own documentation. */
const GOOD_TRAINING = `
resource "aws_sagemaker_training_job" "ranker" {
  training_job_name = "${paramsFor('task_training_run_v1').token}"
  role_arn          = aws_iam_role.training.arn

  algorithm_specification {
    training_input_mode = "File"
    training_image      = "111122223333.dkr.ecr.eu-west-1.amazonaws.com/trainer:3.1.0"
  }

  output_data_config {
    s3_output_path = "s3://models/ranker/output/"
  }

  resource_config {
    instance_type     = "ml.m5.xlarge"
    instance_count    = 1
    volume_size_in_gb = 50
  }

  stopping_condition {
    max_runtime_in_seconds = 7200
  }

  vpc_config {
    security_group_ids = [aws_security_group.training.id]
    subnets            = [aws_subnet.private_a.id, aws_subnet.private_b.id]
  }
}
`;

describe('the training-run task', () => {
  it('passes a run that is bounded, durable and contained', () => {
    const result = gradeSubmission(trainingTask, GOOD_TRAINING, paramsFor(trainingTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The check that decides whether a stalled run costs an hour or a weekend.
   * A hanging training job holds its instances until a person happens to
   * look, and GPU instances are the most expensive thing to leave running.
   */
  it('catches a run with no time ceiling', () => {
    const unbounded = GOOD_TRAINING.replace(/ {2}stopping_condition \{[\s\S]*?\n {2}\}\n/, '');
    const result = gradeSubmission(trainingTask, unbounded, paramsFor(trainingTask.id));
    const failed = result.checks.find((c) => c.id === 'runtime_ceiling');
    expect(failed?.passed).toBe(false);
    expect(failed?.matters).toContain('weekend');
  });

  it('catches a training container left with a route to the internet', () => {
    // A training container reads the most sensitive data the company has.
    const openEgress = GOOD_TRAINING.replace(/ {2}vpc_config \{[\s\S]*?\n {2}\}\n/, '');
    expect(
      gradeSubmission(trainingTask, openEgress, paramsFor(trainingTask.id)).checks.find(
        (c) => c.id === 'contained_network',
      )?.passed,
    ).toBe(false);
  });

  it('catches a vpc_config that names subnets but no security groups', () => {
    const halfDone = GOOD_TRAINING.replace(
      / {4}security_group_ids = \[aws_security_group\.training\.id\]\n/,
      '',
    );
    expect(
      gradeSubmission(trainingTask, halfDone, paramsFor(trainingTask.id)).checks.find(
        (c) => c.id === 'contained_network',
      )?.passed,
    ).toBe(false);
  });

  it('catches an artifact that dies with the instance', () => {
    const noOutput = GOOD_TRAINING.replace(/ {2}output_data_config \{[\s\S]*?\n {2}\}\n/, '');
    expect(
      gradeSubmission(trainingTask, noOutput, paramsFor(trainingTask.id)).checks.find(
        (c) => c.id === 'durable_output',
      )?.passed,
    ).toBe(false);
  });

  it('catches compute nobody chose', () => {
    const defaulted = GOOD_TRAINING.replace(/ {2}resource_config \{[\s\S]*?\n {2}\}\n/, '');
    expect(
      gradeSubmission(trainingTask, defaulted, paramsFor(trainingTask.id)).checks.find(
        (c) => c.id === 'sized_compute',
      )?.passed,
    ).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      trainingTask,
      GOOD_TRAINING,
      deriveTaskParams('cand_someone_else', trainingTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });

  it('is the only task on the track about training rather than inference', () => {
    // The other four all concern a model that already exists. This is how it
    // came to exist, which is where the largest bills and the worst data
    // incidents both live.
    for (const other of tasksForTrack('mlops').filter((t) => t.id !== trainingTask.id)) {
      const brief = other.brief(paramsFor(other.id)).join(' ').toLowerCase();
      expect(brief, other.id).not.toContain('training job');
    }
    // And this one is unambiguously about it.
    expect(trainingTask.brief(paramsFor(trainingTask.id)).join(' ')).toContain('training job');
  });
});

const asyncTask = taskById('task_async_inference_v1')!;

const GOOD_ASYNC = `
resource "aws_sagemaker_endpoint_configuration" "documents" {
  name = "${paramsFor('task_async_inference_v1').token}"

  production_variants {
    variant_name           = "primary"
    model_name             = aws_sagemaker_model.scorer.name
    initial_instance_count = 1
    instance_type          = "ml.m5.large"
  }

  async_inference_config {
    client_config {
      max_concurrent_invocations_per_instance = 4
    }

    output_config {
      s3_output_path  = "s3://scoring/results"
      s3_failure_path = "s3://scoring/failures"

      notification_config {
        error_topic   = aws_sns_topic.scoring_errors.arn
        success_topic = aws_sns_topic.scoring_done.arn
      }
    }
  }
}
`;

describe('the async-inference task', () => {
  it('passes a queue that records its failures', () => {
    const result = gradeSubmission(asyncTask, GOOD_ASYNC, paramsFor(asyncTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  /**
   * The check the task turns on. Successes land somewhere by default in most
   * designs; failures only land where somebody put them, and nobody is
   * holding the connection to notice.
   */
  it('catches results with nowhere for failures to go', () => {
    const noFailurePath = GOOD_ASYNC.replace(/ {6}s3_failure_path.*\n/, '');
    const result = gradeSubmission(asyncTask, noFailurePath, paramsFor(asyncTask.id));
    expect(result.checks.find((c) => c.id === 'failure_destination')?.passed).toBe(false);
    // Successes still land, so the feedback is specific rather than a blanket
    // "output misconfigured".
    expect(result.checks.find((c) => c.id === 'results_destination')?.passed).toBe(true);
  });

  it('catches a failure path nobody is watching', () => {
    const noAlert = GOOD_ASYNC.replace(/ {6}notification_config \{[\s\S]*?\n {6}\}\n/, '');
    const result = gradeSubmission(asyncTask, noAlert, paramsFor(asyncTask.id));
    expect(result.checks.find((c) => c.id === 'failure_notification')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'failure_destination')?.passed).toBe(true);
  });

  it('catches a notification config with only a success topic', () => {
    // Being told about the successes is not being told about the failures.
    const successOnly = GOOD_ASYNC.replace(/ {8}error_topic.*\n/, '');
    expect(
      gradeSubmission(asyncTask, successOnly, paramsFor(asyncTask.id)).checks.find(
        (c) => c.id === 'failure_notification',
      )?.passed,
    ).toBe(false);
  });

  it('catches an unbounded queue', () => {
    const unbounded = GOOD_ASYNC.replace(/ {4}client_config \{[\s\S]*?\n {4}\}\n/, '');
    expect(
      gradeSubmission(asyncTask, unbounded, paramsFor(asyncTask.id)).checks.find(
        (c) => c.id === 'concurrency_ceiling',
      )?.passed,
    ).toBe(false);
  });

  it('does not accept a plain real-time endpoint, which is the shape it rules out', () => {
    const realtime = GOOD_ASYNC.replace(/ {2}async_inference_config \{[\s\S]*?\n {2}\}\n/, '');
    const result = gradeSubmission(asyncTask, realtime, paramsFor(asyncTask.id));
    expect(result.checks.find((c) => c.id === 'async_endpoint')?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('accepts either spelling of the failure path', () => {
    // Being unsure whether it is s3_failure_path or s3_failure_output_path is
    // a poor reason to fail somebody who did the right thing. The rubric
    // tests the concept, not recall of an argument name.
    const variant = GOOD_ASYNC.replace('s3_failure_path', 's3_failure_output_path');
    expect(
      gradeSubmission(asyncTask, variant, paramsFor(asyncTask.id)).checks.find(
        (c) => c.id === 'failure_destination',
      )?.passed,
    ).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      asyncTask,
      GOOD_ASYNC,
      deriveTaskParams('cand_someone_else', asyncTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const rolloutTask = taskById('task_safe_rollout_v1')!;

const GOOD_ROLLOUT = `
resource "aws_cloudwatch_metric_alarm" "model_errors" {
  alarm_name          = "scoring-model-5xx"
  namespace           = "AWS/SageMaker"
  metric_name         = "Invocation5XXErrors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Sum"
  threshold           = 0
}

resource "aws_sagemaker_endpoint" "scoring" {
  name                 = "${paramsFor('task_safe_rollout_v1').token}"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.v2.name

  deployment_config {
    blue_green_update_policy {
      termination_wait_in_seconds          = 600
      maximum_execution_timeout_in_seconds = 1800

      traffic_routing_configuration {
        type                     = "CANARY"
        wait_interval_in_seconds = 300

        canary_size {
          type  = "CAPACITY_PERCENT"
          value = 10
        }
      }
    }

    auto_rollback_configuration {
      alarms {
        alarm_name = aws_cloudwatch_metric_alarm.model_errors.alarm_name
      }
    }
  }
}
`;

describe('the safe-rollout task', () => {
  it('passes a staged rollout that can actually go back', () => {
    const result = gradeSubmission(rolloutTask, GOOD_ROLLOUT, paramsFor(rolloutTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the cutover every check is written against', () => {
    // The one-attribute answer: point the endpoint at the new config and
    // call it a deployment. It is valid Terraform and it moves every caller
    // at the same instant.
    const cutover = `
resource "aws_sagemaker_endpoint" "scoring" {
  name                 = "${paramsFor('task_safe_rollout_v1').token}"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.v2.name
}
`;
    const result = gradeSubmission(rolloutTask, cutover, paramsFor(rolloutTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed)).toEqual([]);
    expect(result.passed).toBe(false);
  });

  it('rejects ALL_AT_ONCE even wrapped in a deployment config', () => {
    // The shape of a staged rollout with none of the property. This is the
    // submission the task exists to catch.
    const allAtOnce = GOOD_ROLLOUT.replace('"CANARY"', '"ALL_AT_ONCE"');
    const result = gradeSubmission(rolloutTask, allAtOnce, paramsFor(rolloutTask.id));
    expect(result.checks.find((c) => c.id === 'gradual_traffic_shift')?.passed).toBe(false);
  });

  it('rejects an alarm that watches the host instead of the model', () => {
    const hostAlarm = GOOD_ROLLOUT.replace('"Invocation5XXErrors"', '"CPUUtilization"');
    const result = gradeSubmission(rolloutTask, hostAlarm, paramsFor(rolloutTask.id));
    expect(result.checks.find((c) => c.id === 'alarm_measures_the_model')?.passed).toBe(false);
  });

  it('rejects tearing the old fleet down the moment traffic finishes moving', () => {
    const noWait = GOOD_ROLLOUT.replace(
      'termination_wait_in_seconds          = 600',
      'termination_wait_in_seconds          = 0',
    );
    const result = gradeSubmission(rolloutTask, noWait, paramsFor(rolloutTask.id));
    expect(result.checks.find((c) => c.id === 'old_fleet_retained')?.passed).toBe(false);
  });

  it('accepts LINEAR as readily as CANARY', () => {
    // Both stage the shift. The rubric grades the property, not one spelling
    // of it.
    const linear = GOOD_ROLLOUT.replace('"CANARY"', '"LINEAR"').replace(
      'canary_size',
      'linear_step_size',
    );
    const result = gradeSubmission(rolloutTask, linear, paramsFor(rolloutTask.id));
    expect(result.checks.find((c) => c.id === 'gradual_traffic_shift')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      rolloutTask,
      GOOD_ROLLOUT,
      deriveTaskParams('cand_someone_else', rolloutTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const retrainTask = taskById('task_retraining_loop_v1')!;

const GOOD_RETRAIN = `
resource "aws_sagemaker_pipeline" "retrain" {
  pipeline_name         = "${paramsFor('task_retraining_loop_v1').token}"
  pipeline_display_name = "retrain-scoring"
  role_arn              = aws_iam_role.pipeline.arn

  pipeline_definition = jsonencode({
    Version = "2020-12-01"
    Steps = [
      {
        Name = "TrainOnRecentData"
        Type = "Training"
      },
      {
        Name = "IsItBetterThanWhatIsLive"
        Type = "Condition"
        Arguments = {
          Conditions = [
            {
              Type       = "GreaterThanOrEqualTo"
              LeftValue  = "candidate_auc"
              RightValue = 0.82
            }
          ]
          IfSteps = [
            {
              Name = "RegisterCandidate"
              Type = "RegisterModel"
              Arguments = {
                ModelPackageGroupName = "scoring-models"
                ModelApprovalStatus   = "PendingManualApproval"
              }
            }
          ]
          ElseSteps = []
        }
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "drift_detected" {
  name        = "scoring-drift-detected"
  description = "Starts the retrain when the monitor reports violations"
}

resource "aws_cloudwatch_event_target" "start_retrain" {
  rule     = aws_cloudwatch_event_rule.drift_detected.name
  arn      = aws_sagemaker_pipeline.retrain.arn
  role_arn = aws_iam_role.events.arn
}
`;

describe('the retraining-loop task', () => {
  it('passes a loop that retrains but stops at the registry', () => {
    const result = gradeSubmission(retrainTask, GOOD_RETRAIN, paramsFor(retrainTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails a pipeline that nothing starts and nothing gates', () => {
    const bare = `
resource "aws_sagemaker_pipeline" "retrain" {
  pipeline_name         = "${paramsFor('task_retraining_loop_v1').token}"
  pipeline_display_name = "retrain-scoring"
  role_arn              = aws_iam_role.pipeline.arn
  pipeline_definition   = jsonencode({ Version = "2020-12-01", Steps = [] })
}
`;
    const result = gradeSubmission(retrainTask, bare, paramsFor(retrainTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual([
      'orchestrated_retrain',
    ]);
    expect(result.passed).toBe(false);
  });

  it('rejects a loop that approves its own output', () => {
    // The automated accident: retrain, register, approve, and the first
    // person to learn the model changed is a customer.
    const autoApprove = GOOD_RETRAIN.replace('"PendingManualApproval"', '"Approved"');
    const result = gradeSubmission(retrainTask, autoApprove, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'approval_stays_manual')?.passed).toBe(false);
  });

  it('rejects a retrain that still waits for somebody to start it', () => {
    const noTrigger = GOOD_RETRAIN.split('resource "aws_cloudwatch_event_rule"')[0]!;
    const result = gradeSubmission(retrainTask, noTrigger, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'runs_unattended')?.passed).toBe(false);
  });

  it('rejects a retrain that carries any model forward unchecked', () => {
    const noGate = GOOD_RETRAIN.replace('Type = "Condition"', 'Type = "Callback"');
    const result = gradeSubmission(retrainTask, noGate, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'quality_gate')?.passed).toBe(false);
  });

  it('does not mistake an IAM policy condition for a quality gate', () => {
    // rawText sees the whole submission, so a policy Condition block must not
    // read as the pipeline deciding whether the model is good enough.
    const policyOnly = GOOD_RETRAIN.replace('Type = "Condition"', 'Type = "Callback"').concat(`
resource "aws_iam_role_policy" "events" {
  name   = "start-pipeline"
  role   = aws_iam_role.events.id
  policy = jsonencode({
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sagemaker:StartPipelineExecution"
        Resource  = aws_sagemaker_pipeline.retrain.arn
        Condition = { StringEquals = { "aws:SourceAccount" = "111122223333" } }
      }
    ]
  })
}
`);
    const result = gradeSubmission(retrainTask, policyOnly, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'quality_gate')?.passed).toBe(false);
  });

  it('does not accept a rule that fires into nothing', () => {
    // An event rule with no target is a subscription with no subscriber. It
    // parses, it plans, and it starts nothing.
    const ruleOnly = GOOD_RETRAIN.split('resource "aws_cloudwatch_event_target"')[0]!;
    const result = gradeSubmission(retrainTask, ruleOnly, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'runs_unattended')?.passed).toBe(false);
  });

  it('accepts EventBridge Scheduler as readily as a rule', () => {
    const scheduled = GOOD_RETRAIN.split('resource "aws_cloudwatch_event_rule"')[0]!.concat(`
resource "aws_scheduler_schedule" "weekly_retrain" {
  name                = "scoring-weekly-retrain"
  schedule_expression = "rate(7 days)"

  target {
    arn      = aws_sagemaker_pipeline.retrain.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
`);
    const result = gradeSubmission(retrainTask, scheduled, paramsFor(retrainTask.id));
    expect(result.checks.find((c) => c.id === 'runs_unattended')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      retrainTask,
      GOOD_RETRAIN,
      deriveTaskParams('cand_someone_else', retrainTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const workbenchTask = taskById('task_model_workbench_v1')!;

const GOOD_WORKBENCH = `
resource "aws_sagemaker_domain" "team" {
  domain_name             = "${paramsFor('task_model_workbench_v1').token}"
  auth_mode               = "IAM"
  vpc_id                  = aws_vpc.analytics.id
  subnet_ids              = aws_subnet.private[*].id
  app_network_access_type = "VpcOnly"
  kms_key_id              = aws_kms_key.workbench.arn

  default_user_settings {
    execution_role  = aws_iam_role.studio_user.arn
    security_groups = [aws_security_group.studio.id]

    jupyter_lab_app_settings {
      app_lifecycle_management {
        idle_settings {
          lifecycle_management  = "ENABLED"
          idle_timeout_in_minutes = 60
        }
      }
    }
  }
}
`;

describe('the model-workbench task', () => {
  it('passes a workbench that is closed off and closes itself', () => {
    const result = gradeSubmission(workbenchTask, GOOD_WORKBENCH, paramsFor(workbenchTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the domain that works perfectly and protects nothing', () => {
    // Valid Terraform, creates a usable Studio domain, and every graded
    // property is absent. This is the submission the task exists to catch.
    const wideOpen = `
resource "aws_sagemaker_domain" "team" {
  domain_name = "${paramsFor('task_model_workbench_v1').token}"
  auth_mode   = "IAM"
  vpc_id      = aws_vpc.analytics.id
  subnet_ids  = aws_subnet.private[*].id

  default_user_settings {
    execution_role = aws_iam_role.studio_user.arn
  }
}
`;
    const result = gradeSubmission(workbenchTask, wideOpen, paramsFor(workbenchTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['studio_domain']);
    expect(result.passed).toBe(false);
  });

  it('rejects a domain left on the public default', () => {
    const publicDomain = GOOD_WORKBENCH.replace('"VpcOnly"', '"PublicInternetOnly"');
    const result = gradeSubmission(workbenchTask, publicDomain, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'no_direct_internet')?.passed).toBe(false);
  });

  it('rejects VpcOnly with no security groups behind it', () => {
    // The route is restricted and nothing governs what travels it.
    const noGroups = GOOD_WORKBENCH.replace(
      '    security_groups = [aws_security_group.studio.id]',
      '',
    );
    const result = gradeSubmission(workbenchTask, noGroups, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'egress_controlled')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'no_direct_internet')?.passed).toBe(true);
  });

  it('rejects unencrypted domain storage', () => {
    const noKms = GOOD_WORKBENCH.replace(
      '  kms_key_id              = aws_kms_key.workbench.arn',
      '',
    );
    const result = gradeSubmission(workbenchTask, noKms, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'home_storage_encrypted')?.passed).toBe(false);
  });

  it('rejects a workbench that bills until somebody looks', () => {
    const noIdle = GOOD_WORKBENCH.replace('idle_timeout_in_minutes = 60', '');
    const result = gradeSubmission(workbenchTask, noIdle, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'idle_shutdown')?.passed).toBe(false);
  });

  it('reads the idle timeout however deeply it is nested', () => {
    // The path runs default_user_settings, an app settings block,
    // app_lifecycle_management, idle_settings. Candidates may hang it off the
    // code editor instead of JupyterLab, which is the same answer.
    const codeEditor = GOOD_WORKBENCH.replace(
      'jupyter_lab_app_settings',
      'code_editor_app_settings',
    );
    const result = gradeSubmission(workbenchTask, codeEditor, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'idle_shutdown')?.passed).toBe(true);
  });

  it('does not accept an idle timeout of zero', () => {
    const zero = GOOD_WORKBENCH.replace(
      'idle_timeout_in_minutes = 60',
      'idle_timeout_in_minutes = 0',
    );
    const result = gradeSubmission(workbenchTask, zero, paramsFor(workbenchTask.id));
    expect(result.checks.find((c) => c.id === 'idle_shutdown')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      workbenchTask,
      GOOD_WORKBENCH,
      deriveTaskParams('cand_someone_else', workbenchTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const networkTask = taskById('task_network_exposure_v1')!;

const GOOD_NETWORK = `
resource "aws_security_group" "db" {
  name        = "${paramsFor('task_network_exposure_v1').token}"
  description = "Customer records database"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "from_app" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "to_app_subnet" {
  security_group_id = aws_security_group.db.id
  cidr_ipv4         = "10.0.16.0/20"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
`;

describe('the network-exposure task', () => {
  it('passes a database reachable only from the application', () => {
    const result = gradeSubmission(networkTask, GOOD_NETWORK, paramsFor(networkTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects the rule somebody added to rule the group out', () => {
    // Opened to prove the group was not the cause of a failure, then left.
    const open = GOOD_NETWORK.replace(
      'referenced_security_group_id = aws_security_group.app.id',
      'cidr_ipv4                    = "0.0.0.0/0"',
    );
    const result = gradeSubmission(networkTask, open, paramsFor(networkTask.id));
    expect(result.checks.find((c) => c.id === 'nothing_open_to_the_world')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'source_is_named')?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('rejects an open range written the older inline way', () => {
    // The rubric has to catch this in both spellings, not just the modern one.
    const inline = `
resource "aws_security_group" "db" {
  name        = "${paramsFor('task_network_exposure_v1').token}"
  description = "Customer records database"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`;
    const result = gradeSubmission(networkTask, inline, paramsFor(networkTask.id));
    expect(result.checks.find((c) => c.id === 'nothing_open_to_the_world')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'egress_is_bounded')?.passed).toBe(false);
  });

  it('accepts a correct answer written the older inline way', () => {
    // Same rubric, older spelling. Neither shape is the graded property.
    const inline = `
resource "aws_security_group" "db" {
  name        = "${paramsFor('task_network_exposure_v1').token}"
  description = "Customer records database"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.16.0/20"]
  }
}
`;
    const result = gradeSubmission(networkTask, inline, paramsFor(networkTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a narrow source with every port behind it', () => {
    const allPorts = GOOD_NETWORK.replace(
      'from_port                    = 5432',
      'from_port                    = 0',
    ).replace('to_port                      = 5432', 'to_port                      = 65535');
    const result = gradeSubmission(networkTask, allPorts, paramsFor(networkTask.id));
    expect(result.checks.find((c) => c.id === 'ports_are_narrow')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'source_is_named')?.passed).toBe(true);
  });

  it('rejects unrestricted egress', () => {
    const openOut = GOOD_NETWORK.replace(
      'cidr_ipv4         = "10.0.16.0/20"',
      'cidr_ipv4         = "0.0.0.0/0"',
    );
    const result = gradeSubmission(networkTask, openOut, paramsFor(networkTask.id));
    expect(result.checks.find((c) => c.id === 'egress_is_bounded')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      networkTask,
      GOOD_NETWORK,
      deriveTaskParams('cand_someone_else', networkTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const trailTask = taskById('task_audit_trail_v1')!;

const GOOD_TRAIL = `
resource "aws_s3_bucket" "audit" {
  bucket = "acme-audit-log"
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_cloudtrail" "account" {
  name                          = "${paramsFor('task_audit_trail_v1').token}"
  s3_bucket_name                = aws_s3_bucket.audit.id
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  include_global_service_events = true
  kms_key_id                    = aws_kms_key.audit.arn
}
`;

describe('the audit-trail task', () => {
  it('passes a trail that records everywhere and can be proven intact', () => {
    const result = gradeSubmission(trailTask, GOOD_TRAIL, paramsFor(trailTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails a trail that exists and protects nothing', () => {
    const bare = `
resource "aws_cloudtrail" "account" {
  name           = "${paramsFor('task_audit_trail_v1').token}"
  s3_bucket_name = "acme-audit-log"
}
`;
    const result = gradeSubmission(trailTask, bare, paramsFor(trailTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['trail_exists']);
    expect(result.passed).toBe(false);
  });

  it('rejects a single-region trail', () => {
    const oneRegion = GOOD_TRAIL.replace(
      'is_multi_region_trail         = true',
      'is_multi_region_trail         = false',
    );
    const result = gradeSubmission(trailTask, oneRegion, paramsFor(trailTask.id));
    expect(result.checks.find((c) => c.id === 'covers_every_region')?.passed).toBe(false);
  });

  it('rejects a trail whose files cannot be proven unaltered', () => {
    const noValidation = GOOD_TRAIL.replace(
      'enable_log_file_validation    = true',
      'enable_log_file_validation    = false',
    );
    const result = gradeSubmission(trailTask, noValidation, paramsFor(trailTask.id));
    expect(result.checks.find((c) => c.id === 'logs_are_tamper_evident')?.passed).toBe(false);
  });

  it('rejects a log bucket a delivered record can simply be deleted from', () => {
    const noVersioning = GOOD_TRAIL.split('resource "aws_s3_bucket_versioning"')[0]!.concat(`
resource "aws_cloudtrail" "account" {
  name                       = "${paramsFor('task_audit_trail_v1').token}"
  s3_bucket_name             = aws_s3_bucket.audit.id
  is_multi_region_trail      = true
  enable_log_file_validation = true
  kms_key_id                 = aws_kms_key.audit.arn
}
`);
    const result = gradeSubmission(trailTask, noVersioning, paramsFor(trailTask.id));
    expect(result.checks.find((c) => c.id === 'records_cannot_be_quietly_removed')?.passed).toBe(
      false,
    );
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      trailTask,
      GOOD_TRAIL,
      deriveTaskParams('cand_someone_else', trailTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const secretTask = taskById('task_secret_handling_v1')!;

const GOOD_SECRET = `
resource "aws_secretsmanager_secret" "db" {
  name       = "${paramsFor('task_secret_handling_v1').token}"
  kms_key_id = aws_kms_key.secrets.arn
}

resource "random_password" "db" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({ username = "app", password = random_password.db.result })
}

resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = aws_lambda_function.rotate.arn

  rotation_rules {
    automatically_after_days = 30
  }
}

resource "aws_iam_role_policy" "app_reads_secret" {
  name = "read-db-password"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.db.arn
      }
    ]
  })
}
`;

describe('the secret-handling task', () => {
  it('passes a secret nobody typed into the file', () => {
    const result = gradeSubmission(secretTask, GOOD_SECRET, paramsFor(secretTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('catches the credential typed straight into the configuration', () => {
    // This is the trap. It plans, it applies, the application can read the
    // secret, and the password is now in version control forever.
    const hardcoded = GOOD_SECRET.replace(
      'secret_string = jsonencode({ username = "app", password = random_password.db.result })',
      'secret_string = "correct-horse-battery-staple"',
    );
    const result = gradeSubmission(secretTask, hardcoded, paramsFor(secretTask.id));
    expect(result.checks.find((c) => c.id === 'no_credential_in_the_code')?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails it on a score that would otherwise have passed', () => {
    // The mechanism, stated directly rather than inferred from one task.
    // Four of five checks pass, the pass mark is four, and the submission
    // still fails. Without this the allowed miss would be spent on the one
    // thing the task exists to prevent.
    const hardcoded = GOOD_SECRET.replace(
      'secret_string = jsonencode({ username = "app", password = random_password.db.result })',
      'secret_string = "correct-horse-battery-staple"',
    );
    const result = gradeSubmission(secretTask, hardcoded, paramsFor(secretTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(result.passMark);
    expect(result.passed).toBe(false);
    expect(result.disqualifiedBy).toBe('no_credential_in_the_code');
  });

  it('reports no disqualification when nothing disqualifying failed', () => {
    const result = gradeSubmission(secretTask, GOOD_SECRET, paramsFor(secretTask.id));
    expect(result.disqualifiedBy).toBeUndefined();
  });

  it('does not mistake a generated value for a hardcoded one', () => {
    // A bare reference rather than a jsonencode. Still not a literal.
    const referenced = GOOD_SECRET.replace(
      'secret_string = jsonencode({ username = "app", password = random_password.db.result })',
      'secret_string = random_password.db.result',
    );
    const result = gradeSubmission(secretTask, referenced, paramsFor(secretTask.id));
    expect(result.checks.find((c) => c.id === 'no_credential_in_the_code')?.passed).toBe(true);
  });

  it('rejects a secret on the default key', () => {
    const defaultKey = GOOD_SECRET.replace('  kms_key_id = aws_kms_key.secrets.arn', '');
    const result = gradeSubmission(secretTask, defaultKey, paramsFor(secretTask.id));
    expect(result.checks.find((c) => c.id === 'customer_managed_key')?.passed).toBe(false);
  });

  it('rejects a password that never changes', () => {
    const noRotation = GOOD_SECRET.split('resource "aws_secretsmanager_secret_rotation"')[0]!;
    const result = gradeSubmission(secretTask, noRotation, paramsFor(secretTask.id));
    expect(result.checks.find((c) => c.id === 'rotation_configured')?.passed).toBe(false);
  });

  it('rejects a secret with no policy saying who may read it', () => {
    const noPolicy = GOOD_SECRET.split('resource "aws_iam_role_policy"')[0]!;
    const result = gradeSubmission(secretTask, noPolicy, paramsFor(secretTask.id));
    expect(result.checks.find((c) => c.id === 'read_access_is_scoped')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      secretTask,
      GOOD_SECRET,
      deriveTaskParams('cand_someone_else', secretTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const tableTask = taskById('task_durable_table_v1')!;

const GOOD_TABLE = `
resource "aws_dynamodb_table" "orders" {
  name                        = "${paramsFor('task_durable_table_v1').token}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "orderId"
  deletion_protection_enabled = true

  attribute {
    name = "orderId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.orders.arn
  }
}
`;

describe('the durable-table task', () => {
  it('passes a table that can be restored and cannot be dropped', () => {
    const result = gradeSubmission(tableTask, GOOD_TABLE, paramsFor(tableTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the table that works and keeps nothing', () => {
    // Serves reads, serves writes, passes review. The absence is discovered
    // once, at the worst moment, by somebody who cannot act on it.
    const plain = `
resource "aws_dynamodb_table" "orders" {
  name           = "${paramsFor('task_durable_table_v1').token}"
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }
}
`;
    const result = gradeSubmission(tableTask, plain, paramsFor(tableTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['table_with_a_key']);
    expect(result.passed).toBe(false);
  });

  it('rejects recovery that is present but switched off', () => {
    const off = GOOD_TABLE.replace(
      'point_in_time_recovery {\n    enabled = true',
      'point_in_time_recovery {\n    enabled = false',
    );
    const result = gradeSubmission(tableTask, off, paramsFor(tableTask.id));
    expect(result.checks.find((c) => c.id === 'recoverable')?.passed).toBe(false);
  });

  it('rejects a ttl block with no attribute to expire on', () => {
    const noAttr = GOOD_TABLE.replace('    attribute_name = "expiresAt"\n', '');
    const result = gradeSubmission(tableTask, noAttr, paramsFor(tableTask.id));
    expect(result.checks.find((c) => c.id === 'old_records_expire')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      tableTask,
      GOOD_TABLE,
      deriveTaskParams('cand_someone_else', tableTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const originTask = taskById('task_private_origin_v1')!;

const GOOD_ORIGIN = `
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "site-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled = true
  comment = "${paramsFor('task_private_origin_v1').token}"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.site.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
`;

describe('the private-origin task', () => {
  it('passes a distribution whose bucket stays private', () => {
    const result = gradeSubmission(originTask, GOOD_ORIGIN, paramsFor(originTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects an origin reached without access control', () => {
    // The quick route: make the bucket readable and point at it. The site
    // works and the origin is fetchable directly, past every control.
    const noOac = GOOD_ORIGIN.split('resource "aws_cloudfront_origin_access_control"')[0]!.concat(`
resource "aws_cloudfront_distribution" "site" {
  enabled = true
  comment = "${paramsFor('task_private_origin_v1').token}"

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "site"
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
  }

  viewer_certificate {
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
`);
    const result = gradeSubmission(originTask, noOac, paramsFor(originTask.id));
    expect(result.checks.find((c) => c.id === 'origin_access_control')?.passed).toBe(false);
  });

  it('rejects a distribution that still answers plain HTTP', () => {
    const allowAll = GOOD_ORIGIN.replace('"redirect-to-https"', '"allow-all"');
    const result = gradeSubmission(originTask, allowAll, paramsFor(originTask.id));
    expect(result.checks.find((c) => c.id === 'https_only')?.passed).toBe(false);
  });

  it('rejects obsolete TLS behind a correct redirect', () => {
    const oldTls = GOOD_ORIGIN.replace('"TLSv1.2_2021"', '"TLSv1"');
    const result = gradeSubmission(originTask, oldTls, paramsFor(originTask.id));
    expect(result.checks.find((c) => c.id === 'modern_tls')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'https_only')?.passed).toBe(true);
  });

  it('accepts https-only as readily as a redirect', () => {
    const httpsOnly = GOOD_ORIGIN.replace('"redirect-to-https"', '"https-only"');
    const result = gradeSubmission(originTask, httpsOnly, paramsFor(originTask.id));
    expect(result.checks.find((c) => c.id === 'https_only')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      originTask,
      GOOD_ORIGIN,
      deriveTaskParams('cand_someone_else', originTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const queueTask = taskById('task_reliable_queue_v1')!;

const GOOD_QUEUE = `
resource "aws_sqs_queue" "orders_failed" {
  name                      = "orders-failed"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "orders" {
  name                       = "${paramsFor('task_reliable_queue_v1').token}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 1209600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_failed.arn
    maxReceiveCount     = 5
  })
}
`;

describe('the reliable-queue task', () => {
  it('passes a queue whose failures end up somewhere', () => {
    const result = gradeSubmission(queueTask, GOOD_QUEUE, paramsFor(queueTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the single queue that silently drops what it cannot process', () => {
    const lone = `
resource "aws_sqs_queue" "orders" {
  name = "${paramsFor('task_reliable_queue_v1').token}"
}
`;
    const result = gradeSubmission(queueTask, lone, paramsFor(queueTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed)).toEqual([]);
    expect(result.passed).toBe(false);
  });

  it('rejects a second queue that nothing redrives to', () => {
    // Two queues and no redrive policy is two queues, not a safety net.
    const noRedrive = GOOD_QUEUE.replace(
      /\n {2}redrive_policy = jsonencode\({[\s\S]*?\n {2}\}\)\n/,
      '\n',
    );
    const result = gradeSubmission(queueTask, noRedrive, paramsFor(queueTask.id));
    expect(result.checks.find((c) => c.id === 'failures_are_kept')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'two_queues')?.passed).toBe(true);
  });

  it('rejects a timeout shorter than the work the brief describes', () => {
    // Thirty seconds of work behind a ten second timeout redelivers messages
    // that are still being processed, and the retries spend the redrive
    // budget on work that never failed.
    const short = GOOD_QUEUE.replace(
      'visibility_timeout_seconds = 60',
      'visibility_timeout_seconds = 10',
    );
    const result = gradeSubmission(queueTask, short, paramsFor(queueTask.id));
    expect(result.checks.find((c) => c.id === 'timeout_covers_the_work')?.passed).toBe(false);
  });

  it('rejects retention left at the four-day default', () => {
    const defaultRetention = GOOD_QUEUE.split('\n')
      .filter((line) => !line.includes('message_retention_seconds'))
      .join('\n');
    const result = gradeSubmission(queueTask, defaultRetention, paramsFor(queueTask.id));
    expect(result.checks.find((c) => c.id === 'failures_survive_the_weekend')?.passed).toBe(false);
  });

  it('does not count a retention that only matches the default', () => {
    const exactlyDefault = GOOD_QUEUE.replace(
      /message_retention_seconds( +)= 1209600/g,
      'message_retention_seconds$1= 345600',
    );
    const result = gradeSubmission(queueTask, exactlyDefault, paramsFor(queueTask.id));
    expect(result.checks.find((c) => c.id === 'failures_survive_the_weekend')?.passed).toBe(false);
  });

  it('accepts a customer-managed key instead of SQS-managed encryption', () => {
    const cmk = GOOD_QUEUE.replace(
      /sqs_managed_sse_enabled( +)= true/g,
      'kms_master_key_id$1= aws_kms_key.queue.arn',
    );
    const result = gradeSubmission(queueTask, cmk, paramsFor(queueTask.id));
    expect(result.checks.find((c) => c.id === 'contents_encrypted')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      queueTask,
      GOOD_QUEUE,
      deriveTaskParams('cand_someone_else', queueTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const deployTask = taskById('task_keyless_deploy_v1')!;

const GOOD_DEPLOY = `
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "deploy" {
  name = "${paramsFor('task_keyless_deploy_v1').token}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:acme/platform:ref:refs/heads/main"
          }
        }
      }
    ]
  })
}
`;

describe('the keyless-deploy task', () => {
  it('passes a role only one repository can assume', () => {
    const result = gradeSubmission(deployTask, GOOD_DEPLOY, paramsFor(deployTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('disqualifies a trust policy any repository can assume', () => {
    // Four of five checks pass and the pass mark is four. Without the
    // disqualifying flag this would be verified, while handing the account to
    // anybody who can create a GitHub repository.
    const wildcard = GOOD_DEPLOY.replace('"repo:acme/platform:ref:refs/heads/main"', '"repo:*"');
    const result = gradeSubmission(deployTask, wildcard, paramsFor(deployTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(result.passMark);
    expect(result.passed).toBe(false);
    expect(result.disqualifiedBy).toBe('scoped_to_the_repository');
  });

  it('grades an omitted subject the same as a wildcard one', () => {
    // Both produce a trust policy every repository satisfies. Treating one
    // more gently would grade the typing rather than the outcome.
    const noSubject = GOOD_DEPLOY.replace(
      '            "token.attributes.githubusercontent.com:sub" = "x"\n',
      '',
    ).replace(
      '            "token.actions.githubusercontent.com:sub" = "repo:acme/platform:ref:refs/heads/main"\n',
      '',
    );
    const result = gradeSubmission(deployTask, noSubject, paramsFor(deployTask.id));
    expect(result.checks.find((c) => c.id === 'scoped_to_the_repository')?.passed).toBe(false);
    expect(result.disqualifiedBy).toBe('scoped_to_the_repository');
    expect(result.passed).toBe(false);
  });

  it('rejects federation added beside the key it replaces', () => {
    const alsoKey = GOOD_DEPLOY.concat(`
resource "aws_iam_user" "ci" {
  name = "ci-deployer"
}

resource "aws_iam_access_key" "ci" {
  user = aws_iam_user.ci.name
}
`);
    const result = gradeSubmission(deployTask, alsoKey, paramsFor(deployTask.id));
    expect(result.checks.find((c) => c.id === 'no_long_lived_key')?.passed).toBe(false);
  });

  it('rejects a trust policy that checks no audience', () => {
    const noAud = GOOD_DEPLOY.replace(
      '            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"\n',
      '',
    );
    const result = gradeSubmission(deployTask, noAud, paramsFor(deployTask.id));
    expect(result.checks.find((c) => c.id === 'audience_checked')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'scoped_to_the_repository')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      deployTask,
      GOOD_DEPLOY,
      deriveTaskParams('cand_someone_else', deployTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const alarmTask = taskById('task_alarm_that_fires_v1')!;

const GOOD_ALARM = `
resource "aws_sns_topic" "oncall" {
  name = "api-oncall"
}

resource "aws_sns_topic_subscription" "oncall_email" {
  topic_arn = aws_sns_topic.oncall.arn
  protocol  = "email"
  endpoint  = "oncall@example.com"
}

resource "aws_cloudwatch_metric_alarm" "failures" {
  alarm_name          = "${paramsFor('task_alarm_that_fires_v1').token}"
  namespace           = "Acme/Api"
  metric_name         = "FailedRequests"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.oncall.arn]
}
`;

describe('the alarm-that-fires task', () => {
  it('passes an alarm that survives the API going silent', () => {
    const result = gradeSubmission(alarmTask, GOOD_ALARM, paramsFor(alarmTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects the default that goes quiet in a total outage', () => {
    // The dashboard stays green, the alarm sits in INSUFFICIENT_DATA, and the
    // first report comes from a customer.
    const defaulted = GOOD_ALARM.replace('  treat_missing_data  = "breaching"\n', '');
    const result = gradeSubmission(alarmTask, defaulted, paramsFor(alarmTask.id));
    expect(result.checks.find((c) => c.id === 'silence_counts_as_failure')?.passed).toBe(false);
  });

  it('rejects notBreaching, which is the same silence spelled deliberately', () => {
    const notBreaching = GOOD_ALARM.replace('"breaching"', '"notBreaching"');
    const result = gradeSubmission(alarmTask, notBreaching, paramsFor(alarmTask.id));
    expect(result.checks.find((c) => c.id === 'silence_counts_as_failure')?.passed).toBe(false);
  });

  it('rejects a topic nobody subscribed to', () => {
    const noSub = GOOD_ALARM.split('resource "aws_sns_topic_subscription"')[0]!.concat(
      GOOD_ALARM.split('resource "aws_cloudwatch_metric_alarm"')[1]!.replace(
        /^/,
        'resource "aws_cloudwatch_metric_alarm"',
      ),
    );
    const result = gradeSubmission(alarmTask, noSub, paramsFor(alarmTask.id));
    expect(result.checks.find((c) => c.id === 'someone_receives_it')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'somebody_is_told')?.passed).toBe(true);
  });

  it('rejects an alarm that pages on one bad minute', () => {
    const twitchy = GOOD_ALARM.replace(
      '  evaluation_periods  = 3\n',
      '  evaluation_periods  = 1\n',
    ).replace('  datapoints_to_alarm = 2\n', '');
    const result = gradeSubmission(alarmTask, twitchy, paramsFor(alarmTask.id));
    expect(result.checks.find((c) => c.id === 'not_one_stray_minute')?.passed).toBe(false);
  });

  it('accepts evaluation periods alone, without datapoints_to_alarm', () => {
    const periodsOnly = GOOD_ALARM.replace('  datapoints_to_alarm = 2\n', '');
    const result = gradeSubmission(alarmTask, periodsOnly, paramsFor(alarmTask.id));
    expect(result.checks.find((c) => c.id === 'not_one_stray_minute')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      alarmTask,
      GOOD_ALARM,
      deriveTaskParams('cand_someone_else', alarmTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const registryTask = taskById('task_image_supply_chain_v1')!;

const GOOD_REGISTRY = `
resource "aws_ecr_repository" "services" {
  name                 = "${paramsFor('task_image_supply_chain_v1').token}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.registry.arn
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  repository = aws_ecr_repository.services.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      }
    ]
  })
}
`;

describe('the image-supply-chain task', () => {
  it('passes a registry whose tags mean one thing', () => {
    const result = gradeSubmission(registryTask, GOOD_REGISTRY, paramsFor(registryTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the registry that works and guarantees nothing', () => {
    const plain = `
resource "aws_ecr_repository" "services" {
  name = "${paramsFor('task_image_supply_chain_v1').token}"
}
`;
    const result = gradeSubmission(registryTask, plain, paramsFor(registryTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['repository']);
    expect(result.passed).toBe(false);
  });

  it('rejects mutable tags written out explicitly', () => {
    const mutable = GOOD_REGISTRY.replace('"IMMUTABLE"', '"MUTABLE"');
    const result = gradeSubmission(registryTask, mutable, paramsFor(registryTask.id));
    expect(result.checks.find((c) => c.id === 'tags_are_immutable')?.passed).toBe(false);
  });

  it('accepts the exclusion variant as immutable', () => {
    // IMMUTABLE_WITH_EXCLUSION is still an immutability policy, and grading
    // it as mutable would fail a more precise answer than the one expected.
    const withExclusion = GOOD_REGISTRY.replace('"IMMUTABLE"', '"IMMUTABLE_WITH_EXCLUSION"');
    const result = gradeSubmission(registryTask, withExclusion, paramsFor(registryTask.id));
    expect(result.checks.find((c) => c.id === 'tags_are_immutable')?.passed).toBe(true);
  });

  it('rejects scanning that is configured but switched off', () => {
    const off = GOOD_REGISTRY.replace('scan_on_push = true', 'scan_on_push = false');
    const result = gradeSubmission(registryTask, off, paramsFor(registryTask.id));
    expect(result.checks.find((c) => c.id === 'scanned_on_push')?.passed).toBe(false);
  });

  it('rejects a registry nothing ever prunes', () => {
    const noLifecycle = GOOD_REGISTRY.split('resource "aws_ecr_lifecycle_policy"')[0]!;
    const result = gradeSubmission(registryTask, noLifecycle, paramsFor(registryTask.id));
    expect(result.checks.find((c) => c.id === 'old_images_expire')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      registryTask,
      GOOD_REGISTRY,
      deriveTaskParams('cand_someone_else', registryTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const workflowTask = taskById('task_resilient_workflow_v1')!;

const GOOD_WORKFLOW = `
resource "aws_sfn_state_machine" "orders" {
  name     = "${paramsFor('task_resilient_workflow_v1').token}"
  role_arn = aws_iam_role.states.arn

  logging_configuration {
    level                  = "ERROR"
    include_execution_data = true
    log_destination        = "\${aws_cloudwatch_log_group.states.arn}:*"
  }

  definition = jsonencode({
    StartAt = "TakePayment"
    States = {
      TakePayment = {
        Type     = "Task"
        Resource = aws_lambda_function.take_payment.arn
        Retry = [
          {
            ErrorEquals     = ["States.Timeout", "ProviderUnavailable"]
            IntervalSeconds = 2
            MaxAttempts     = 4
            BackoffRate     = 2
          }
        ]
        Catch = [
          {
            ErrorEquals = ["PaymentDeclined"]
            Next        = "RecordDeclined"
          }
        ]
        Next = "WriteResult"
      }
      WriteResult    = { Type = "Task", Resource = aws_lambda_function.write.arn, End = true }
      RecordDeclined = { Type = "Task", Resource = aws_lambda_function.declined.arn, End = true }
    }
  })
}
`;

describe('the resilient-workflow task', () => {
  it('passes a workflow that survives a slow provider', () => {
    const result = gradeSubmission(workflowTask, GOOD_WORKFLOW, paramsFor(workflowTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the state machine that is valid and gives up on everything', () => {
    // Deploys, passes a demo, and in production a two second blip leaves the
    // order half processed with nothing recording which half.
    const brittle = `
resource "aws_sfn_state_machine" "orders" {
  name     = "${paramsFor('task_resilient_workflow_v1').token}"
  role_arn = aws_iam_role.states.arn

  definition = jsonencode({
    StartAt = "TakePayment"
    States = {
      TakePayment = { Type = "Task", Resource = aws_lambda_function.take_payment.arn, End = true }
    }
  })
}
`;
    const result = gradeSubmission(workflowTask, brittle, paramsFor(workflowTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['state_machine']);
    expect(result.passed).toBe(false);
  });

  it('rejects a retry that hammers at a fixed rate', () => {
    const noBackoff = GOOD_WORKFLOW.replace('            BackoffRate     = 2\n', '').replace(
      '            IntervalSeconds = 2\n',
      '',
    );
    const result = gradeSubmission(workflowTask, noBackoff, paramsFor(workflowTask.id));
    expect(result.checks.find((c) => c.id === 'retries_back_off')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'transient_failures_retry')?.passed).toBe(true);
  });

  it('rejects retry without a catch for what will never succeed', () => {
    const noCatch = GOOD_WORKFLOW.replace(/ {8}Catch = \[[\s\S]*?\n {8}\]\n/, '');
    const result = gradeSubmission(workflowTask, noCatch, paramsFor(workflowTask.id));
    expect(result.checks.find((c) => c.id === 'permanent_failures_caught')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'transient_failures_retry')?.passed).toBe(true);
  });

  it('rejects a workflow nobody can see inside at 3am', () => {
    const noLogs = GOOD_WORKFLOW.replace(/ {2}logging_configuration \{[\s\S]*?\n {2}\}\n/, '');
    const result = gradeSubmission(workflowTask, noLogs, paramsFor(workflowTask.id));
    expect(result.checks.find((c) => c.id === 'failures_are_visible')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      workflowTask,
      GOOD_WORKFLOW,
      deriveTaskParams('cand_someone_else', workflowTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const apiTask = taskById('task_bounded_api_v1')!;

const GOOD_API = `
resource "aws_apigatewayv2_api" "public" {
  name          = "${paramsFor('task_bounded_api_v1').token}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://app.example.com"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["authorization", "content-type"]
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.public.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "app-users"

  jwt_configuration {
    audience = ["app"]
    issuer   = "https://issuer.example.com"
  }
}

resource "aws_apigatewayv2_route" "orders" {
  api_id             = aws_apigatewayv2_api.public.id
  route_key          = "GET /orders"
  target             = "integrations/\${aws_apigatewayv2_integration.orders.id}"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
  authorization_type = "JWT"
}

resource "aws_apigatewayv2_stage" "live" {
  api_id      = aws_apigatewayv2_api.public.id
  name        = "live"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = "$context.requestId $context.status $context.identity.sourceIp"
  }
}
`;

describe('the bounded-api task', () => {
  it('passes an API that is authorized, capped, and logged', () => {
    const result = gradeSubmission(apiTask, GOOD_API, paramsFor(apiTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects an authorizer declared and attached to nothing', () => {
    // Present in the plan, absent from the request path. The API still
    // answers whoever asks.
    const detached = GOOD_API.replace(
      '  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id\n',
      '',
    );
    const result = gradeSubmission(apiTask, detached, paramsFor(apiTask.id));
    expect(result.checks.find((c) => c.id === 'requests_are_authorized')?.passed).toBe(false);
  });

  it('rejects a stage with no ceiling on how fast it can be called', () => {
    const noThrottle = GOOD_API.replace(/ {2}default_route_settings \{[\s\S]*?\n {2}\}\n/, '');
    const result = gradeSubmission(apiTask, noThrottle, paramsFor(apiTask.id));
    expect(result.checks.find((c) => c.id === 'throughput_is_capped')?.passed).toBe(false);
  });

  it('rejects a wildcard browser origin', () => {
    const anyOrigin = GOOD_API.replace('["https://app.example.com"]', '["*"]');
    const result = gradeSubmission(apiTask, anyOrigin, paramsFor(apiTask.id));
    expect(result.checks.find((c) => c.id === 'browser_origins_are_named')?.passed).toBe(false);
  });

  it('accepts a burst limit alone as a ceiling', () => {
    const burstOnly = GOOD_API.replace('    throttling_rate_limit  = 50\n', '');
    const result = gradeSubmission(apiTask, burstOnly, paramsFor(apiTask.id));
    expect(result.checks.find((c) => c.id === 'throughput_is_capped')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      apiTask,
      GOOD_API,
      deriveTaskParams('cand_someone_else', apiTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const budgetTask = taskById('task_cost_alarm_v1')!;

const GOOD_BUDGET = `
resource "aws_budgets_budget" "account" {
  name         = "${paramsFor('task_cost_alarm_v1').token}"
  budget_type  = "COST"
  limit_amount = "400"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["platform@example.com"]
  }
}
`;

describe('the cost-alarm task', () => {
  it('passes a budget that warns while the month is still running', () => {
    const result = gradeSubmission(budgetTask, GOOD_BUDGET, paramsFor(budgetTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a receipt dressed as a warning', () => {
    // Actual spend at a hundred percent. It fires the moment there is nothing
    // left to protect.
    const receipt = GOOD_BUDGET.replace('"FORECASTED"', '"ACTUAL"').replace(
      'threshold                  = 80',
      'threshold                  = 100',
    );
    const result = gradeSubmission(budgetTask, receipt, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'warns_on_the_forecast')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'warns_before_the_limit')?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('rejects a budget nobody hears about', () => {
    const noSubscriber = GOOD_BUDGET.replace(
      '    subscriber_email_addresses = ["platform@example.com"]\n',
      '',
    );
    const result = gradeSubmission(budgetTask, noSubscriber, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'somebody_is_notified')?.passed).toBe(false);
  });

  it('rejects a budget that notifies on underspending', () => {
    const wrongWay = GOOD_BUDGET.replace('"GREATER_THAN"', '"LESS_THAN"');
    const result = gradeSubmission(budgetTask, wrongWay, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'triggers_when_exceeded')?.passed).toBe(false);
  });

  it('accepts an SNS topic instead of an email subscriber', () => {
    const viaTopic = GOOD_BUDGET.replace(
      'subscriber_email_addresses = ["platform@example.com"]',
      'subscriber_sns_topic_arns  = [aws_sns_topic.billing.arn]',
    );
    const result = gradeSubmission(budgetTask, viaTopic, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'somebody_is_notified')?.passed).toBe(true);
  });

  it('accepts an absolute threshold that sits below the budget', () => {
    // 80 dollars against a 400 dollar budget warns at a fifth of it, which is
    // earlier than the percentage answer rather than worse than it. An
    // earlier version of this check only understood percentages and failed
    // this submission, which is a rubric failing somebody for being right.
    const absolute = GOOD_BUDGET.replace('"PERCENTAGE"', '"ABSOLUTE_VALUE"');
    const result = gradeSubmission(budgetTask, absolute, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'warns_before_the_limit')?.passed).toBe(true);
  });

  it('rejects an absolute threshold at or above the budget', () => {
    const atLimit = GOOD_BUDGET.replace('"PERCENTAGE"', '"ABSOLUTE_VALUE"').replace(
      'threshold                  = 80',
      'threshold                  = 400',
    );
    const result = gradeSubmission(budgetTask, atLimit, paramsFor(budgetTask.id));
    expect(result.checks.find((c) => c.id === 'warns_before_the_limit')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      budgetTask,
      GOOD_BUDGET,
      deriveTaskParams('cand_someone_else', budgetTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const backupTask = taskById('task_recoverable_estate_v1')!;

const GOOD_BACKUP = `
resource "aws_backup_vault" "primary" {
  name        = "primary-vault"
  kms_key_arn = aws_kms_key.backups.arn
}

resource "aws_backup_plan" "databases" {
  name = "${paramsFor('task_recoverable_estate_v1').token}"

  rule {
    rule_name         = "nightly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 3 * * ? *)"
    start_window      = 60
    completion_window = 300

    lifecycle {
      cold_storage_after = 30
      delete_after       = 365
    }

    copy_action {
      destination_vault_arn = aws_backup_vault.offsite.arn

      lifecycle {
        delete_after = 365
      }
    }
  }
}

resource "aws_backup_selection" "databases" {
  name         = "databases"
  plan_id      = aws_backup_plan.databases.id
  iam_role_arn = aws_iam_role.backup.arn

  resources = [
    aws_dynamodb_table.orders.arn,
    aws_dynamodb_table.customers.arn,
  ]
}
`;

describe('the recoverable-estate task', () => {
  it('passes a plan that covers something and survives the region', () => {
    const result = gradeSubmission(backupTask, GOOD_BACKUP, paramsFor(backupTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a plan that runs on schedule and backs up nothing', () => {
    // The green job history for an empty set. Nothing fails, nothing warns,
    // and the discovery happens during a restore.
    const noSelection = GOOD_BACKUP.split('resource "aws_backup_selection"')[0]!;
    const result = gradeSubmission(backupTask, noSelection, paramsFor(backupTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.find((c) => c.id === 'covers_something')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'runs_on_a_schedule')?.passed).toBe(true);
    // Four of five checks pass and the pass mark is four. Coverage is
    // disqualifying, so this fails anyway: a plan protecting nothing has not
    // partly taken a backup, and passing it would put a Zoryvex verification
    // on a submission whose job history is green for an empty set.
    expect(result.score).toBeGreaterThanOrEqual(result.passMark);
    expect(result.disqualifiedBy).toBe('covers_something');
    expect(result.passed).toBe(false);
  });

  it('rejects a selection that names no resources at all', () => {
    // Present, wired to the plan, and selecting nothing. Worse than absent,
    // because it looks answered.
    const emptySelection = GOOD_BACKUP.replace(/ {2}resources = \[[\s\S]*?\n {2}\]\n/, '');
    const result = gradeSubmission(backupTask, emptySelection, paramsFor(backupTask.id));
    expect(result.checks.find((c) => c.id === 'covers_something')?.passed).toBe(false);
  });

  it('accepts a tag-based selection as readily as named ARNs', () => {
    const byTag = GOOD_BACKUP.replace(
      / {2}resources = \[[\s\S]*?\n {2}\]\n/,
      `
  selection_tag {
    type  = "STRINGEQUALS"
    key   = "Backup"
    value = "nightly"
  }
`,
    );
    const result = gradeSubmission(backupTask, byTag, paramsFor(backupTask.id));
    expect(result.checks.find((c) => c.id === 'covers_something')?.passed).toBe(true);
  });

  it('rejects backups that only survive a bad afternoon', () => {
    const oneRegion = GOOD_BACKUP.replace(/ {4}copy_action \{[\s\S]*?\n {4}\}\n/, '');
    const result = gradeSubmission(backupTask, oneRegion, paramsFor(backupTask.id));
    expect(result.checks.find((c) => c.id === 'survives_losing_the_region')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'retention_is_bounded')?.passed).toBe(true);
  });

  it('does not read the offsite copy expiry as the primary one', () => {
    // The rule and the copy_action inside it both take a lifecycle. Reading
    // the subtree found the copy's expiry and called it the rule's, so a plan
    // keeping its primary recovery points for ever passed this check.
    const copyOnly = GOOD_BACKUP.replace('      delete_after       = 365', '');
    const result = gradeSubmission(backupTask, copyOnly, paramsFor(backupTask.id));
    expect(result.checks.find((c) => c.id === 'retention_is_bounded')?.passed).toBe(false);
    // The copy still has its own expiry, so the submission is not simply bare.
    expect(result.checks.find((c) => c.id === 'survives_losing_the_region')?.passed).toBe(true);
  });

  it('rejects recovery points kept for ever', () => {
    const noExpiry = GOOD_BACKUP.replace(
      / {4}lifecycle \{\n {6}cold_storage_after = 30\n {6}delete_after {7}= 365\n {4}\}\n/,
      '',
    );
    const result = gradeSubmission(backupTask, noExpiry, paramsFor(backupTask.id));
    expect(result.checks.find((c) => c.id === 'retention_is_bounded')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      backupTask,
      GOOD_BACKUP,
      deriveTaskParams('cand_someone_else', backupTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const keyTask = taskById('task_key_management_v1')!;

const GOOD_KEY = `
resource "aws_kms_key" "exports" {
  description             = "Accountant exports"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AdminByAccount"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::111122223333:root" }
        Action    = ["kms:Create*", "kms:Describe*", "kms:List*", "kms:ScheduleKeyDeletion"]
        Resource  = "*"
      },
      {
        Sid       = "UseByTheTwoRoles"
        Effect    = "Allow"
        Principal = { AWS = [aws_iam_role.exporter.arn, aws_iam_role.auditor.arn] }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "exports" {
  name          = "alias/${paramsFor('task_key_management_v1').token}"
  target_key_id = aws_kms_key.exports.key_id
}
`;

describe('the key-management task', () => {
  it('passes a key that rotates and names who may use it', () => {
    const result = gradeSubmission(keyTask, GOOD_KEY, paramsFor(keyTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a key still using the material it was created with', () => {
    const noRotation = GOOD_KEY.replace(
      'enable_key_rotation     = true',
      'enable_key_rotation     = false',
    );
    const result = gradeSubmission(keyTask, noRotation, paramsFor(keyTask.id));
    expect(result.checks.find((c) => c.id === 'rotation_enabled')?.passed).toBe(false);
  });

  it('rejects a scoped statement sitting above a permissive one', () => {
    // Names the two roles and also grants everybody. It has granted everybody.
    const alsoOpen = GOOD_KEY.replace(
      'Principal = { AWS = "arn:aws:iam::111122223333:root" }',
      'Principal = "*"',
    );
    const result = gradeSubmission(keyTask, alsoOpen, paramsFor(keyTask.id));
    expect(result.checks.find((c) => c.id === 'not_open_to_the_account')?.passed).toBe(false);
    // The roles are still named, so the other check is unaffected.
    expect(result.checks.find((c) => c.id === 'policy_names_who')?.passed).toBe(true);
  });

  it('rejects a wildcard action on the key', () => {
    const wildcardAction = GOOD_KEY.replace(
      'Action    = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]',
      'Action    = "*"',
    );
    const result = gradeSubmission(keyTask, wildcardAction, paramsFor(keyTask.id));
    expect(result.checks.find((c) => c.id === 'not_open_to_the_account')?.passed).toBe(false);
  });

  it('rejects the seven day deletion window', () => {
    // One holiday long. The window is the only period in which scheduling a
    // key for deletion can be undone.
    const quick = GOOD_KEY.replace('deletion_window_in_days = 30', 'deletion_window_in_days = 7');
    const result = gradeSubmission(keyTask, quick, paramsFor(keyTask.id));
    expect(result.checks.find((c) => c.id === 'deletion_is_slow')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      keyTask,
      GOOD_KEY,
      deriveTaskParams('cand_someone_else', keyTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const vendorTask = taskById('task_third_party_access_v1')!;

const GOOD_VENDOR = `
resource "aws_iam_role" "vendor" {
  name                 = "${paramsFor('task_third_party_access_v1').token}"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = { AWS = "arn:aws:iam::444455556666:root" }
        Condition = {
          StringEquals = {
            "sts:ExternalId" = var.vendor_external_id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "vendor_read" {
  name = "read-only"
  role = aws_iam_role.vendor.id

  policy = jsonencode({
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"]
        Resource = "arn:aws:cloudwatch:eu-west-1:111122223333:*"
      }
    ]
  })
}
`;

describe('the third-party-access task', () => {
  it('passes a vendor role scoped with an external id', () => {
    const result = gradeSubmission(vendorTask, GOOD_VENDOR, paramsFor(vendorTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects the confused deputy, which is the submission that works', () => {
    // Trusts the vendor account and nothing else. The vendor assumes it on
    // behalf of every customer they have, and your account id is not a secret.
    const noExternalId = GOOD_VENDOR.replace(/ {8}Condition = \{[\s\S]*?\n {8}\}\n/, '');
    const result = gradeSubmission(vendorTask, noExternalId, paramsFor(vendorTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.find((c) => c.id === 'external_id_required')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'cross_account_role')?.passed).toBe(true);
  });

  it('does not read a resource ARN ending in a wildcard as a wildcard action', () => {
    // arn:aws:cloudwatch:eu-west-1:111122223333:* is an ordinary scoped
    // resource and ends in :* like a wildcard action does. Grepping the whole
    // policy for a wildcard failed this correct answer, which is the worst
    // way for a rubric to be wrong.
    const result = gradeSubmission(vendorTask, GOOD_VENDOR, paramsFor(vendorTask.id));
    expect(GOOD_VENDOR).toContain(':*"');
    expect(result.checks.find((c) => c.id === 'read_only_permissions')?.passed).toBe(true);
  });

  it('rejects write access dressed as monitoring', () => {
    const canWrite = GOOD_VENDOR.replace(
      '"cloudwatch:GetMetricData", "cloudwatch:ListMetrics"',
      '"cloudwatch:GetMetricData", "cloudwatch:PutMetricData"',
    );
    const result = gradeSubmission(vendorTask, canWrite, paramsFor(vendorTask.id));
    expect(result.checks.find((c) => c.id === 'read_only_permissions')?.passed).toBe(false);
  });

  it('rejects a wildcard in the granted permissions', () => {
    const wildcard = GOOD_VENDOR.replace(
      '"cloudwatch:GetMetricData", "cloudwatch:ListMetrics"',
      '"cloudwatch:*"',
    );
    const result = gradeSubmission(vendorTask, wildcard, paramsFor(vendorTask.id));
    expect(result.checks.find((c) => c.id === 'read_only_permissions')?.passed).toBe(false);
  });

  it('rejects a session with no stated duration', () => {
    const noDuration = GOOD_VENDOR.replace('  max_session_duration = 3600\n', '');
    const result = gradeSubmission(vendorTask, noDuration, paramsFor(vendorTask.id));
    expect(result.checks.find((c) => c.id === 'session_is_bounded')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      vendorTask,
      GOOD_VENDOR,
      deriveTaskParams('cand_someone_else', vendorTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const detectionTask = taskById('task_threat_detection_v1')!;

const GOOD_DETECTION = `
resource "aws_guardduty_detector" "account" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
}

resource "aws_sns_topic" "security" {
  name = "${paramsFor('task_threat_detection_v1').token}"
}

resource "aws_sns_topic_subscription" "security_email" {
  topic_arn = aws_sns_topic.security.arn
  protocol  = "email"
  endpoint  = "security@example.com"
}

resource "aws_cloudwatch_event_rule" "guardduty_high" {
  name = "guardduty-high-severity"

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail = {
      severity = [{ numeric = [">=", 7] }]
    }
  })
}

resource "aws_cloudwatch_event_target" "to_security" {
  rule = aws_cloudwatch_event_rule.guardduty_high.name
  arn  = aws_sns_topic.security.arn
}
`;

describe('the threat-detection task', () => {
  it('passes detection that reaches a person and filters the noise', () => {
    const result = gradeSubmission(detectionTask, GOOD_DETECTION, paramsFor(detectionTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects turning it on and stopping there', () => {
    // One resource, findings in a console nobody opens.
    const onlyDetector = `
resource "aws_guardduty_detector" "account" {
  enable = true
}

resource "aws_sns_topic" "security" {
  name = "${paramsFor('task_threat_detection_v1').token}"
}
`;
    const result = gradeSubmission(detectionTask, onlyDetector, paramsFor(detectionTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['detector_enabled']);
    expect(result.passed).toBe(false);
  });

  it('rejects a detector that is declared and disabled', () => {
    const suspended = GOOD_DETECTION.replace(
      'enable                       = true',
      'enable                       = false',
    );
    const result = gradeSubmission(detectionTask, suspended, paramsFor(detectionTask.id));
    expect(result.checks.find((c) => c.id === 'detector_enabled')?.passed).toBe(false);
  });

  it('rejects a route that forwards everything', () => {
    // Muted within a fortnight, and then everybody believes detection still
    // reaches somebody.
    const noFilter = GOOD_DETECTION.replace(/ {4}detail = \{[\s\S]*?\n {4}\}\n/, '');
    const result = gradeSubmission(detectionTask, noFilter, paramsFor(detectionTask.id));
    expect(result.checks.find((c) => c.id === 'only_what_matters')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'findings_are_routed')?.passed).toBe(true);
  });

  it('reads the event pattern rather than the rule name', () => {
    // The first version of both these checks grepped the whole resource, so a
    // rule called guardduty-high-severity satisfied them on its name while
    // matching something else entirely. A well-named rule is not a filter.
    const misleadingName = `
resource "aws_guardduty_detector" "account" {
  enable = true
}

resource "aws_sns_topic" "security" {
  name = "${paramsFor('task_threat_detection_v1').token}"
}

resource "aws_sns_topic_subscription" "security_email" {
  topic_arn = aws_sns_topic.security.arn
  protocol  = "email"
  endpoint  = "security@example.com"
}

resource "aws_cloudwatch_event_rule" "guardduty_high_severity" {
  name = "guardduty-high-severity"

  event_pattern = jsonencode({
    source = ["aws.ec2"]
  })
}

resource "aws_cloudwatch_event_target" "to_security" {
  rule = aws_cloudwatch_event_rule.guardduty_high_severity.name
  arn  = aws_sns_topic.security.arn
}
`;
    const result = gradeSubmission(detectionTask, misleadingName, paramsFor(detectionTask.id));
    expect(result.checks.find((c) => c.id === 'findings_are_routed')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'only_what_matters')?.passed).toBe(false);
    // The parts that genuinely are present still pass, so this is the name
    // being ignored rather than the submission being rejected wholesale.
    expect(result.checks.find((c) => c.id === 'the_rule_has_a_target')?.passed).toBe(true);
    expect(result.checks.find((c) => c.id === 'a_person_receives_it')?.passed).toBe(true);
  });

  it('rejects a rule that matches and does nothing', () => {
    const noTarget = GOOD_DETECTION.split('resource "aws_cloudwatch_event_target"')[0]!;
    const result = gradeSubmission(detectionTask, noTarget, paramsFor(detectionTask.id));
    expect(result.checks.find((c) => c.id === 'the_rule_has_a_target')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      detectionTask,
      GOOD_DETECTION,
      deriveTaskParams('cand_someone_else', detectionTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const streamTask = taskById('task_stream_consumer_v1')!;

const GOOD_STREAM = `
resource "aws_lambda_event_source_mapping" "index_changes" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = "${paramsFor('task_stream_consumer_v1').token}"
  starting_position = "TRIM_HORIZON"
  batch_size        = 100

  function_response_types        = ["ReportBatchItemFailures"]
  bisect_batch_on_function_error = true
  maximum_retry_attempts         = 5

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.rejected.arn
    }
  }
}
`;

describe('the stream-consumer task', () => {
  it('passes a consumer one bad record cannot stop', () => {
    const result = gradeSubmission(streamTask, GOOD_STREAM, paramsFor(streamTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails the default mapping, which blocks the shard for ever', () => {
    // Valid, deploys, reads the stream. One malformed record stops every
    // change written after it, indefinitely.
    const bare = `
resource "aws_lambda_event_source_mapping" "index_changes" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = "${paramsFor('task_stream_consumer_v1').token}"
  starting_position = "TRIM_HORIZON"
  batch_size        = 100
}
`;
    const result = gradeSubmission(streamTask, bare, paramsFor(streamTask.id));
    expect(result.identityOk).toBe(true);
    expect(result.checks.filter((c) => c.passed).map((c) => c.id)).toEqual(['stream_mapping']);
    expect(result.passed).toBe(false);
  });

  it('rejects a batch failure that takes the whole batch with it', () => {
    const wholeBatch = GOOD_STREAM.replace(
      '  function_response_types        = ["ReportBatchItemFailures"]\n',
      '',
    );
    const result = gradeSubmission(streamTask, wholeBatch, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'partial_failures_reported')?.passed).toBe(false);
  });

  it('does not read the response type from anywhere but its own attribute', () => {
    // The name sitting in a tag is not a configured response type. Three
    // checks in this file were previously wrong for grepping a whole resource
    // instead of the attribute they meant, and this is the guard against that
    // returning. It has to be a tag rather than a comment: the reader
    // discards comments as whitespace, so a comment would fail this check
    // under the old code too and prove nothing.
    const onlyInATag = GOOD_STREAM.replace(
      '  function_response_types        = ["ReportBatchItemFailures"]',
      '  tags = { note = "ReportBatchItemFailures is not switched on yet" }',
    );
    const result = gradeSubmission(streamTask, onlyInATag, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'partial_failures_reported')?.passed).toBe(false);
  });

  it('rejects a consumer that never narrows down the bad record', () => {
    const noBisect = GOOD_STREAM.replace(
      'bisect_batch_on_function_error = true',
      'bisect_batch_on_function_error = false',
    );
    const result = gradeSubmission(streamTask, noBisect, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'poison_record_isolated')?.passed).toBe(false);
  });

  it('rejects retries with no end to them', () => {
    const forever = GOOD_STREAM.replace('  maximum_retry_attempts         = 5\n', '');
    const result = gradeSubmission(streamTask, forever, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'retries_are_bounded')?.passed).toBe(false);
  });

  it('accepts a record age bound instead of an attempt count', () => {
    // Both stop a record being retried for ever. The rubric grades the
    // property, not one way of writing it.
    const byAge = GOOD_STREAM.replace(
      '  maximum_retry_attempts         = 5\n',
      '  maximum_record_age_in_seconds  = 3600\n',
    );
    const result = gradeSubmission(streamTask, byAge, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'retries_are_bounded')?.passed).toBe(true);
  });

  it('rejects bounded retries that simply drop the record', () => {
    const noDestination = GOOD_STREAM.replace(/ {2}destination_config \{[\s\S]*?\n {2}\}\n/, '');
    const result = gradeSubmission(streamTask, noDestination, paramsFor(streamTask.id));
    expect(result.checks.find((c) => c.id === 'rejected_records_kept')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'retries_are_bounded')?.passed).toBe(true);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      streamTask,
      GOOD_STREAM,
      deriveTaskParams('cand_someone_else', streamTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

const flowTask = taskById('task_network_record_v1')!;

const GOOD_FLOW = `
resource "aws_cloudwatch_log_group" "flow" {
  name              = "${paramsFor('task_network_record_v1').token}"
  retention_in_days = 90
}

resource "aws_flow_log" "vpc" {
  vpc_id                   = aws_vpc.main.id
  traffic_type             = "ALL"
  log_destination          = aws_cloudwatch_log_group.flow.arn
  log_destination_type     = "cloud-watch-logs"
  iam_role_arn             = aws_iam_role.flow_logs.arn
  max_aggregation_interval = 60
}
`;

describe('the network-record task', () => {
  it('passes a flow log covering the VPC and the traffic that succeeded', () => {
    const result = gradeSubmission(flowTask, GOOD_FLOW, paramsFor(flowTask.id));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects logging only the traffic that was blocked', () => {
    // The intuitive answer, and the wrong half. Rejects are the attempts that
    // failed; an intrusion that worked is accepted traffic.
    const rejectsOnly = GOOD_FLOW.replace(
      'traffic_type             = "ALL"',
      'traffic_type             = "REJECT"',
    );
    const result = gradeSubmission(flowTask, rejectsOnly, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'records_what_succeeded')?.passed).toBe(false);
    expect(result.score).toBe(result.outOf - 1);

    // Deliberately not disqualifying, and this assertion records the decision
    // so it is not quietly reversed later. The test for that flag is whether
    // the failure is categorical rather than partial. A backup plan covering
    // nothing produces no backups at all; a flow log on REJECT produces real
    // data, just the less useful half, and the candidate has still shown
    // VPC-wide coverage, a destination, retention and a tight interval. That
    // is one wrong judgement inside competent work, which is exactly what the
    // pass margin exists for. They are told why it is the wrong half.
    expect(result.disqualifiedBy).toBeUndefined();
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.id === 'records_what_succeeded')?.matters).toContain(
      'attempts that failed',
    );
  });

  it('accepts ACCEPT as readily as ALL', () => {
    // Both record traffic that got through, which is the graded property.
    const acceptOnly = GOOD_FLOW.replace(
      'traffic_type             = "ALL"',
      'traffic_type             = "ACCEPT"',
    );
    const result = gradeSubmission(flowTask, acceptOnly, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'records_what_succeeded')?.passed).toBe(true);
  });

  it('rejects a flow log attached to one interface at a time', () => {
    // Covers what exists today, and the machine nobody added is the one worth
    // watching.
    const perEni = GOOD_FLOW.replace(
      'vpc_id                   = aws_vpc.main.id',
      'eni_id                   = aws_network_interface.web.id',
    );
    const result = gradeSubmission(flowTask, perEni, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'covers_the_whole_vpc')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'records_what_succeeded')?.passed).toBe(true);
  });

  it('rejects records kept for ever', () => {
    const noRetention = GOOD_FLOW.replace('  retention_in_days = 90\n', '');
    const result = gradeSubmission(flowTask, noRetention, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'retention_is_set')?.passed).toBe(false);
  });

  it('accepts an S3 lifecycle rule when the destination is a bucket', () => {
    // Flow logs can land in S3 instead, where the expiry lives on the bucket
    // rather than on a log group. Same property, different resource.
    const toBucket = `
resource "aws_cloudwatch_log_group" "flow" {
  name = "${paramsFor('task_network_record_v1').token}"
}

resource "aws_s3_bucket_lifecycle_configuration" "flow" {
  bucket = aws_s3_bucket.flow.id

  rule {
    id     = "expire"
    status = "Enabled"

    expiration {
      days = 90
    }
  }
}

resource "aws_flow_log" "vpc" {
  vpc_id                   = aws_vpc.main.id
  traffic_type             = "ALL"
  log_destination          = aws_s3_bucket.flow.arn
  log_destination_type     = "s3"
  max_aggregation_interval = 60
}
`;
    const result = gradeSubmission(flowTask, toBucket, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'retention_is_set')?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('rejects the ten minute default aggregation', () => {
    const slow = GOOD_FLOW.replace(
      'max_aggregation_interval = 60',
      'max_aggregation_interval = 600',
    );
    const result = gradeSubmission(flowTask, slow, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'aggregation_is_tight')?.passed).toBe(false);
  });

  it('rejects the aggregation interval being left out', () => {
    // Absent is the same as 600, because that is the default.
    const absent = GOOD_FLOW.replace('  max_aggregation_interval = 60\n', '');
    const result = gradeSubmission(flowTask, absent, paramsFor(flowTask.id));
    expect(result.checks.find((c) => c.id === 'aggregation_is_tight')?.passed).toBe(false);
  });

  it('still refuses a copied submission', () => {
    const copied = gradeSubmission(
      flowTask,
      GOOD_FLOW,
      deriveTaskParams('cand_someone_else', flowTask.id),
    );
    expect(copied.identityOk).toBe(false);
    expect(copied.passed).toBe(false);
  });
});

describe('a policy written the way the provider documentation recommends', () => {
  /**
   * The rubrics read policy text out of the resource that holds it. A policy
   * can equally be built in an `aws_iam_policy_document` data source and
   * attached with `.json`, which is what the provider docs recommend and what
   * this repository's own ci-deploy-role does. `findResources` filters on
   * `type === 'resource'`, so that form left the resource holding nothing but
   * a reference and the check reported the policy as absent.
   *
   * A candidate was told they had not written something they had written, in
   * the more idiomatic of the two forms. These fixtures are the idiomatic
   * form.
   */
  it('passes the TLS-only check when the deny lives in a policy document', () => {
    const p = paramsFor('task_s3_lockdown_v1');
    const submission = `
data "aws_iam_policy_document" "tls_only" {
  statement {
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::${p.token}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "b" {
  bucket = aws_s3_bucket.b.id
  policy = data.aws_iam_policy_document.tls_only.json
}
`;
    const result = gradeSubmission(s3Task, submission, p);
    const tls = result.checks.find((c) => c.id === 'tls_only');
    expect(tls?.passed, JSON.stringify(tls)).toBe(true);
  });

  it('does not pass on a policy document that was never attached', () => {
    // Writing the document and forgetting the bucket policy is a real miss,
    // and widening where the text is read must not turn it into a pass.
    const p = paramsFor('task_s3_lockdown_v1');
    const submission = `
data "aws_iam_policy_document" "tls_only" {
  statement {
    effect   = "Deny"
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
`;
    const result = gradeSubmission(s3Task, submission, p);
    expect(result.checks.find((c) => c.id === 'tls_only')?.passed).toBe(false);
  });

  it('passes the Lambda trust check when the trust policy is a document', () => {
    const p = paramsFor('task_least_privilege_role_v1');
    const submission = `
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "r" {
  name               = "${p.token}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}
`;
    const result = gradeSubmission(roleTask, submission, p);
    const trust = result.checks.find((c) => c.id === 'lambda_trust');
    expect(trust?.passed, JSON.stringify(trust)).toBe(true);
  });
});

describe('wildcard checks see a policy written either way', () => {
  /**
   * `no_wildcard_action` and `scoped_resources` are the entire point of the
   * least-privilege task, and both read text that only ever carried quotes
   * for the `jsonencode()` form. The same policy written as an
   * `aws_iam_policy_document` parses into real strings with no quotes, so the
   * most permissive possible answer walked through both checks named for
   * catching it.
   */
  const withPolicyDocument = (actions: string, resources: string) => `
data "aws_iam_policy_document" "p" {
  statement {
    effect    = "Allow"
    actions   = ${actions}
    resources = ${resources}
  }
}

resource "aws_iam_role" "r" {
  name               = "svc"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

resource "aws_iam_role_policy" "rp" {
  role   = aws_iam_role.r.id
  policy = data.aws_iam_policy_document.p.json
}
`;

  it('catches a wildcard action hidden in a policy document', () => {
    const p = paramsFor('task_least_privilege_role_v1');
    const result = gradeSubmission(
      roleTask,
      withPolicyDocument('["s3:*"]', '["arn:aws:s3:::b/*"]'),
      p,
    );
    expect(result.checks.find((c) => c.id === 'no_wildcard_action')?.passed).toBe(false);
  });

  it('catches a bare star resource hidden in a policy document', () => {
    const p = paramsFor('task_least_privilege_role_v1');
    const result = gradeSubmission(roleTask, withPolicyDocument('["s3:GetObject"]', '["*"]'), p);
    expect(result.checks.find((c) => c.id === 'scoped_resources')?.passed).toBe(false);
  });

  it('still passes a scoped policy, including an ARN that ends in a star', () => {
    // The brief rules out the unqualified star, not every star: scoping to a
    // log group is `arn:aws:logs:...:*` and is exactly right.
    const p = paramsFor('task_least_privilege_role_v1');
    const result = gradeSubmission(
      roleTask,
      withPolicyDocument(
        '["logs:CreateLogStream", "logs:PutLogEvents"]',
        '["arn:aws:logs:eu-west-1:111122223333:log-group:/aws/lambda/svc:*"]',
      ),
      p,
    );
    expect(result.checks.find((c) => c.id === 'no_wildcard_action')?.passed).toBe(true);
    expect(result.checks.find((c) => c.id === 'scoped_resources')?.passed).toBe(true);
  });

  it('still catches the jsonencode form it always caught', () => {
    const p = paramsFor('task_least_privilege_role_v1');
    const submission = `
resource "aws_iam_role_policy" "rp" {
  role = "svc"
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }]
  })
}
`;
    const result = gradeSubmission(roleTask, submission, p);
    expect(result.checks.find((c) => c.id === 'no_wildcard_action')?.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'scoped_resources')?.passed).toBe(false);
  });
});

describe('the read-only check reads both renderings', () => {
  /**
   * It read `Action` out of a `jsonencode()` body only. A policy written as
   * an `aws_iam_policy_document` produced no actions at all, and the check
   * returns false when it finds none, so every candidate using the idiomatic
   * form failed it whether their policy was read-only or not.
   */
  const vendorTask = taskById('task_third_party_access_v1')!;

  const withActions = (actions: string) => `
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::111122223333:root"]
    }
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = ["shared-secret"]
    }
  }
}

data "aws_iam_policy_document" "p" {
  statement {
    effect    = "Allow"
    actions   = ${actions}
    resources = ["arn:aws:s3:::b/*"]
  }
}

resource "aws_iam_role" "vendor" {
  name                 = "vendor"
  max_session_duration = 3600
  assume_role_policy   = data.aws_iam_policy_document.trust.json
}

resource "aws_iam_role_policy" "rp" {
  role   = aws_iam_role.vendor.id
  policy = data.aws_iam_policy_document.p.json
}
`;

  it('passes a genuinely read-only policy written as a document', () => {
    const p = paramsFor('task_third_party_access_v1');
    const result = gradeSubmission(vendorTask, withActions('["s3:GetObject", "s3:ListBucket"]'), p);
    const check = result.checks.find((c) => c.id === 'read_only_permissions');
    expect(check?.passed, JSON.stringify(check)).toBe(true);
  });

  it('still fails a write action written as a document', () => {
    const p = paramsFor('task_third_party_access_v1');
    const result = gradeSubmission(vendorTask, withActions('["s3:DeleteObject"]'), p);
    expect(result.checks.find((c) => c.id === 'read_only_permissions')?.passed).toBe(false);
  });

  it('still fails a service-wide wildcard written as a document', () => {
    const p = paramsFor('task_third_party_access_v1');
    const result = gradeSubmission(vendorTask, withActions('["s3:*"]'), p);
    expect(result.checks.find((c) => c.id === 'read_only_permissions')?.passed).toBe(false);
  });
});

describe('policies are read through the helpers that understand both renderings', () => {
  /**
   * Seven rubrics once read policy text with
   * `rawText(findResources(blocks, '<type>'))`, which cannot see an
   * `aws_iam_policy_document` data source. Two denied credit for the better
   * answer, three certified the worst one, and one failed everybody equally.
   *
   * The helpers exist now, but nothing stops the next task being written the
   * old way, and the old way looks perfectly reasonable. This is the thing
   * that would have caught all seven.
   *
   * The SQS redrive check is deliberately still direct: `redrive_policy` is a
   * queue argument with no policy-document form, so there is nothing for a
   * helper to find.
   */
  it('never reads a policy-bearing resource directly', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'domain', 'graded-task-service.ts'),
      'utf8',
    );
    const direct = [...source.matchAll(/rawText\(findResources\(\w+, '([a-z0-9_]+)'\)\)/g)].map(
      (m) => m[1] ?? '',
    );
    const policyBearing = direct.filter((type) => /iam|kms|_policy$/.test(type));
    expect(
      policyBearing,
      `these read policy text directly and will miss an aws_iam_policy_document: ${policyBearing.join(', ')}. ` +
        'Use policyText, policyActionValues or valuesUnderKey.',
    ).toEqual([]);
  });
});

/**
 * A pass mark of zero passes everything, including an empty submission, and
 * does it quietly: no error, no failed check, just verified evidence handed
 * to somebody who demonstrated nothing. Pass marks are now derived from
 * GRADED_TASKS itself so the old two-list mistake cannot recur, and these
 * assert the property that mattered rather than the mechanism.
 */
describe('every task has a usable pass mark', () => {
  it('never leaves a task at the zero its literal declares', () => {
    const unset = GRADED_TASKS.filter((task) => task.passMark <= 0).map((task) => task.id);
    expect(unset, `these tasks would pass any submission: ${unset.join(', ')}`).toEqual([]);
  });

  it('never sets a pass mark higher than the checks that exist', () => {
    // The other direction: a task nobody can pass is as broken as one
    // nobody can fail, and would strand every candidate who attempted it.
    const impossible = GRADED_TASKS.filter((task) => task.passMark > task.checks.length).map(
      (task) => task.id,
    );
    expect(impossible, `these tasks cannot be passed: ${impossible.join(', ')}`).toEqual([]);
  });

  it('rejects an empty submission for every task', () => {
    // The end-to-end statement of the same property, through the real
    // grader rather than through the pass-mark field.
    for (const task of GRADED_TASKS) {
      const params = deriveTaskParams('candidate-under-test', task.id);
      const result = gradeSubmission(task, '', params);
      expect(result.passed, `${task.id} passed an empty submission`).toBe(false);
    }
  });
});
