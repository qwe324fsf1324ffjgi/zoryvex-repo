import { createHash } from 'node:crypto';
import { TRACK_CAPABILITIES, type Capability, type LaunchTrack } from '@zoryvex/contracts';
import {
  attrAnywhere,
  boolAttr,
  findDataSources,
  findNested,
  findResources,
  parseHcl,
  rawText,
  stringAttr,
  type HclBlock,
  type HclValue,
} from '../lib/hcl';

/**
 * A practical task, scored the same way every time, that a candidate does
 * once and every employer can rely on.
 *
 * This exists because of the clearest finding in the market research, which
 * is really one problem seen from two chairs. Hiring managers report that
 * bad hires trace to interviews testing vocabulary rather than work:
 * describing Kubernetes is not running a cluster during an incident.
 * Candidates report take-home assignments demanding up to forty unpaid
 * hours, repeated for every employer they apply to. A check done once and
 * reusable by everybody removes both costs at the same time.
 *
 * Three rules shape everything below.
 *
 * DETERMINISTIC. The rubric is code, not judgement. The same submission
 * scores identically today and in a year, which is what makes the result
 * something an employer can rely on and a candidate can appeal. No model
 * scores anything here; CLAUDE.md forbids AI making the call, and an opinion
 * that varies between runs would not be verification.
 *
 * SHORT. Every task is scoped to well under an hour. A verification that
 * costs forty hours has simply moved the problem rather than solved it.
 *
 * NEVER SILENT. Every check that does not pass says what was missing and
 * why it mattered. A candidate who fails learns something true about the
 * work, which is the least a platform can offer for their time.
 */

/**
 * Each candidate gets their own version of the task.
 *
 * The rubric is published on purpose, so nothing about a task is secret and
 * a passing submission can be shared. Multiple task variants raise the cost
 * of that without fixing it. Naming does: the brief tells each candidate a
 * name of their own, the rubric requires it, and a copied answer arrives
 * carrying somebody else's name.
 *
 * Derived from the candidate and task ids rather than generated randomly, so
 * it is stable. The same person always gets the same assignment, which means
 * they cannot re-roll for an easier one, a half-finished attempt is still
 * valid tomorrow, and grading stays reproducible: the property the whole
 * feature rests on.
 */
export interface TaskParams {
  /** A short name unique to this candidate and task. */
  token: string;
  /** For tasks that ask for a specific number, so a copied value is visible. */
  retentionDays: number;
}

const RETENTION_CHOICES = [7, 14, 30, 60, 90, 180] as const;

export function deriveTaskParams(candidateId: string, taskId: string): TaskParams {
  const digest = createHash('sha256').update(`${candidateId}:${taskId}`).digest('hex');
  return {
    token: `zx-${digest.slice(0, 8)}`,
    retentionDays: RETENTION_CHOICES[parseInt(digest.slice(8, 12), 16) % RETENTION_CHOICES.length]!,
  };
}

export interface RubricCheck {
  id: string;
  /** What is being looked for, in the candidate's terms. */
  requirement: string;
  /** Shown when it does not pass. Says what was missing, never just "failed". */
  missing: string;
  /** Why a real system needs it, so a failed check teaches something. */
  matters: string;
  /**
   * Failing this fails the task outright, whatever the score.
   *
   * The pass mark deliberately allows one miss, because forgetting an
   * argument is a normal day and a rubric demanding perfection grades
   * trivia. That reasoning holds for things a candidate left out. It does
   * not hold for things a candidate put in. Writing a credential into the
   * configuration is not a gap in an otherwise good answer, it is the one
   * outcome the task exists to prevent, and absorbing it as the allowed miss
   * would let a submission pass while doing the exact harm being tested for.
   *
   * Same reasoning as the identity gate, applied to a check rather than to
   * authorship. Use it only where a failure is categorical rather than
   * partial, and never as a way to make an ordinary check count double.
   */
  disqualifying?: true;
  /**
   * What to do about it, when this check is the one that ended the attempt.
   *
   * Belongs to the check rather than to the grader because the advice is
   * specific: telling somebody to rotate a credential makes sense after they
   * pasted one and is nonsense after they wrote a wildcard into a trust
   * policy. Without this the first disqualifying check's wording would have
   * been shown for the second.
   */
  remedy?: string;
  run(blocks: HclBlock[], params: TaskParams): boolean;
}

export interface GradedTask {
  id: string;
  /**
   * What passing this task demonstrates, which is the thing being verified.
   *
   * `track` below is retained and is now derived rather than authoritative:
   * it says which role this task was written for, which is useful history and
   * useless as a lookup key. A task is found by the capability it proves, so
   * the same task can serve a role nobody had thought of when it was written.
   */
  capabilities: readonly Capability[];
  track: LaunchTrack;
  title: string;
  brief(params: TaskParams): string[];
  timeboxMinutes: number;
  /**
   * The gate that makes a copied submission fail.
   *
   * Deliberately NOT one of the scored checks. The pass mark allows one
   * miss, so a borrowed answer failing only on the name would still score
   * enough to pass — which would defeat the entire mechanism. This is
   * evaluated separately and a failure ends the attempt whatever the score.
   */
  identity: {
    requirement: string;
    missing: string;
    run(blocks: HclBlock[], params: TaskParams): boolean;
  };
  /** How many checks must pass. Deliberately below total: see PASS_MARGIN. */
  passMark: number;
  checks: RubricCheck[];
}

/**
 * A task is passed on most checks, not all of them.
 *
 * Requiring perfection would mean one forgotten argument fails somebody who
 * plainly knows the work, and would push the rubric toward the trivia the
 * research says wrecks technical interviews. Missing one thing is a normal
 * day; missing half of them is not knowing the subject.
 */
const PASS_MARGIN = 1;

/**
 * Policy text, wherever the candidate chose to put it.
 *
 * A policy is written inline as a `jsonencode()` expression, or built in an
 * `aws_iam_policy_document` data source and attached by `.json`. The second
 * is what the provider documentation recommends and what this repository's
 * own `ci-deploy-role` uses.
 *
 * Reading only the resource meant a candidate who used the data source had
 * their policy read as absent: the resource holds nothing but a reference.
 * They were told they had not written something they had written, in the
 * more idiomatic of the two forms. A rubric that marks the better answer
 * wrong is the exact failure these tasks exist to avoid, and the same
 * reasoning is already written out above `ingressRules` for inline versus
 * split security-group rules.
 */
function policyText(blocks: HclBlock[], resourceType: string): string {
  return rawText([
    ...findResources(blocks, resourceType),
    ...findDataSources(blocks, 'aws_iam_policy_document'),
  ]);
}

function hasDenyInsecureTransport(blocks: HclBlock[]): boolean {
  // Looked for as text rather than by parsing JSON out of HCL, because the
  // policy is usually an expression the reader deliberately does not
  // evaluate. Both markers must appear: the condition alone could belong to
  // an Allow. Requires the bucket policy to exist, so a candidate who wrote
  // the document and never attached it does not pass on the document alone.
  if (findResources(blocks, 'aws_s3_bucket_policy').length === 0) return false;
  const source = policyText(blocks, 'aws_s3_bucket_policy');
  return source.includes('aws:SecureTransport') && source.includes('Deny');
}

/**
 * Container image URIs declared on a SageMaker model.
 *
 * Read from the literal text because an image referenced through a variable
 * or a data source cannot be inspected for pinning, and the brief asks for
 * the URI written out for exactly that reason.
 */
/** Any attribute on a block whose name matches, for checks that care about the concept rather than one spelling. */
function hasAttrMatching(block: HclBlock, pattern: RegExp): boolean {
  return Object.keys(block.attributes).some((k) => pattern.test(k));
}

/**
 * Security group rules, written either inline on the group or as their own
 * resource. Both spellings are current, and the split resources are what the
 * provider documentation now recommends, so a rubric that only understood
 * inline blocks would mark the more up-to-date answer wrong.
 */
function ingressRules(blocks: HclBlock[]): HclBlock[] {
  return [
    ...findResources(blocks, 'aws_security_group').flatMap((g) => findNested(g, 'ingress')),
    ...findResources(blocks, 'aws_vpc_security_group_ingress_rule'),
  ];
}

function egressRules(blocks: HclBlock[]): HclBlock[] {
  return [
    ...findResources(blocks, 'aws_security_group').flatMap((g) => findNested(g, 'egress')),
    ...findResources(blocks, 'aws_vpc_security_group_egress_rule'),
  ];
}

/** Every CIDR one rule allows, across both spellings. */
function ruleCidrs(rule: HclBlock): string[] {
  const out: string[] = [];
  for (const single of ['cidr_ipv4', 'cidr_ipv6']) {
    const v = rule.attributes[single];
    if (v && v.kind === 'string') out.push(v.value);
  }
  for (const listed of ['cidr_blocks', 'ipv6_cidr_blocks']) {
    const v = rule.attributes[listed];
    if (v && v.kind === 'list') {
      for (const item of v.items) if (item.kind === 'string') out.push(item.value);
    }
  }
  return out;
}

/**
 * Nested blocks written directly on this one, not at any depth below it.
 *
 * findNested searches the whole subtree, which is right nearly everywhere and
 * wrong wherever the same block name appears at two levels. A backup rule and
 * the copy_action inside it both take a lifecycle, so the recursive search
 * read the copy's expiry as the rule's, and a plan whose primary recovery
 * points were kept for ever passed for the offsite copy having an expiry.
 */
function directBlocks(block: HclBlock, type: string): HclBlock[] {
  return block.blocks.filter((b) => b.type === type);
}

/**
 * The raw text of one attribute.
 *
 * rawText takes a whole subtree, which reads resource names along with
 * everything else. Both GuardDuty checks were written that way and both were
 * wrong: the fixture rule was called guardduty-high-severity, so a grep for
 * "guardduty" and a grep for "severity" matched its name rather than its event
 * pattern, and any rule with a well-chosen name would have passed while
 * matching nothing. A check about what a pattern says has to read the pattern.
 */
function attrText(block: HclBlock, name: string): string {
  const v = block.attributes[name];
  if (v === undefined) return '';
  if (v.kind === 'string') return v.value;
  if (v.kind === 'unparsed') return v.raw;
  if (v.kind === 'ref') return v.value;
  return '';
}

/**
 * Just the Action values out of a policy document.
 *
 * A check about what may be done has to read the actions and nothing else.
 * Grepping the whole document for a wildcard finds resource ARNs, which end
 * in :* perfectly legitimately, and a first attempt at this failed a correct
 * answer for exactly that reason. Resources, principals and conditions all
 * live in the same text and none of them is being asked about here.
 */
function policyActions(text: string): string {
  const found: string[] = [];
  const pattern = /"?Action"?\s*[=:]\s*(\[[^\]]*\]|"[^"]*")/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    found.push(match[1] ?? '');
    match = pattern.exec(text);
  }
  return found.join(' ');
}

/**
 * Every value written under a matching attribute name, anywhere in the
 * submission, from either way of writing a policy.
 *
 * `rawText` joins tokens with spaces and drops quotes, so a pattern looking
 * for `"s3:*"` only ever matched the `jsonencode()` form, whose body survives
 * as one unparsed expression with its quotes intact. The same policy written
 * as an `aws_iam_policy_document` parses into real strings, and every
 * wildcard check reading quoted text silently passed it.
 *
 * That direction matters more than the missed-credit one fixed alongside it:
 * `no_wildcard_action` and `scoped_resources` are the entire point of the
 * least-privilege task, and the most permissive possible answer was walking
 * through both.
 */
function valuesUnderKey(blocks: HclBlock[], keyPattern: RegExp): string[] {
  const out: string[] = [];
  const collect = (v: HclValue) => {
    if (v.kind === 'string' || v.kind === 'ref') out.push(v.value);
    else if (v.kind === 'unparsed') out.push(v.raw);
    else if (v.kind === 'list') v.items.forEach(collect);
  };
  const walk = (b: HclBlock) => {
    for (const [key, value] of Object.entries(b.attributes)) {
      if (keyPattern.test(key)) collect(value);
    }
    b.blocks.forEach(walk);
  };
  blocks.forEach(walk);
  return out;
}

/** `*` on its own, or a service-wide `s3:*`. Not `s3:GetObject`. */
function isWildcardAction(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '*' || /^[a-z0-9]+:\*$/i.test(trimmed);
}

/**
 * Every action a policy grants, from either rendering.
 *
 * Structured `actions = [...]` values, plus the individual strings inside a
 * `jsonencode()` body's `Action` field. One list, so every check that asks a
 * question about actions asks it of the same thing.
 */
function policyActionValues(blocks: HclBlock[]): string[] {
  const structured = valuesUnderKey(blocks, /^actions?$/i);
  const fromJson = [...policyActions(rawText(blocks)).matchAll(/"([^"]+)"/g)].map(
    (m) => m[1] ?? '',
  );
  return [...structured, ...fromJson];
}

/**
 * True when any policy in the submission grants a wildcard action, written
 * either way.
 */
function grantsWildcardAction(blocks: HclBlock[]): boolean {
  return policyActionValues(blocks).some(isWildcardAction);
}

/**
 * True when any policy scopes to a bare `*`.
 *
 * An ARN that happens to end in a star is normal and passes: scoping to a log
 * group is `arn:aws:logs:...:*`, and the brief rules out the unqualified
 * star, not every star.
 */
function grantsWildcardResource(blocks: HclBlock[]): boolean {
  const values = valuesUnderKey(blocks, /^resources?$/i);
  if (values.some((v) => v.trim() === '*')) return true;
  return /Resource\s*[:=]\s*"\*"/.test(rawText(blocks));
}

const OPEN_TO_THE_WORLD = ['0.0.0.0/0', '::/0'];

/**
 * A number that may have been written as one or quoted as a string.
 *
 * Some arguments are documented as strings even though they hold numbers,
 * `limit_amount` on a budget among them, and candidates write both.
 */
function numericish(value: HclValue | undefined): number | null {
  if (value === undefined) return null;
  if (value.kind === 'number') return value.value;
  if (value.kind === 'string') {
    const parsed = Number(value.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** What SQS keeps a message for when nobody says otherwise: four days. */
const DEFAULT_SQS_RETENTION_SECONDS = 345_600;

function numberAttr(block: HclBlock, name: string): number | null {
  const v = block.attributes[name];
  return v && v.kind === 'number' ? v.value : null;
}

/**
 * Seconds in an ISO 8601 duration, for the shapes Azure spells durations in.
 *
 * Azure writes PT1M, PT5M, PT30S, PT1H rather than a number, across Monitor
 * windows and Service Bus locks alike. The difference between PT1M and PT5M
 * is the difference between paging somebody for one bad minute and paging
 * them for a sustained failure; the difference between PT30S and PT10S is a
 * message handed to a second worker while the first is still on it.
 *
 * Anything unrecognised returns null rather than a guess, so a check reads it
 * as "not stated" and fails closed. Guessing here would pass a submission on
 * a duration nobody can point to.
 */
function isoSeconds(value: string | null): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (!m || m.slice(1).every((group) => group === undefined)) return null;
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0)
  );
}

/** The same value in minutes, for the checks that read a window. */
function isoMinutes(value: string | null): number | null {
  const seconds = isoSeconds(value);
  return seconds === null ? null : seconds / 60;
}

/**
 * Azure's consumption budget, at either scope.
 *
 * The same budget is a different resource type depending on whether it is
 * attached to a resource group or to the subscription, and the brief does not
 * say which to use because both are correct answers to it. Reading only one
 * would fail a submission for choosing the other, which is a grading bug
 * rather than a finding about the candidate.
 */
function budgetBlocks(blocks: HclBlock[]): HclBlock[] {
  return [
    ...findResources(blocks, 'azurerm_consumption_budget_resource_group'),
    ...findResources(blocks, 'azurerm_consumption_budget_subscription'),
  ];
}

function modelImages(blocks: HclBlock[]): string[] {
  const images: string[] = [];
  for (const model of findResources(blocks, 'aws_sagemaker_model')) {
    for (const container of [
      ...findNested(model, 'primary_container'),
      ...findNested(model, 'container'),
    ]) {
      const image = stringAttr(container, 'image');
      if (image) images.push(image);
    }
  }
  return images;
}

/**
 * A pinned image is one you could redeploy in a year and get the same bytes.
 * A digest is ideal, an explicit tag is acceptable, `:latest` is neither and
 * an untagged URI resolves to `:latest` implicitly.
 */
export function isPinnedImage(image: string): boolean {
  if (image.includes('@sha256:')) return true;
  const lastSegment = image.slice(image.lastIndexOf('/') + 1);
  const tag = lastSegment.includes(':') ? lastSegment.slice(lastSegment.indexOf(':') + 1) : '';
  if (tag === '') return false;
  return tag.toLowerCase() !== 'latest';
}

const S3_LOCKDOWN: GradedTask = {
  id: 'task_s3_lockdown_v1',
  capabilities: ['data_protection', 'network_isolation'],
  track: 'cloud_security',
  title: 'Lock down a bucket holding sensitive documents',
  timeboxMinutes: 40,
  brief: (p) => [
    'Write Terraform for one S3 bucket that will hold scanned identity documents.',
    `Name the bucket ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'It must not be reachable publicly by any route, including a future bucket policy or ACL.',
    'Objects must be encrypted at rest, and an overwritten or deleted object must be recoverable.',
    'Plain HTTP requests to the bucket must be rejected, not merely discouraged.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The bucket is named as the brief specifies',
    missing:
      'The bucket name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_s3_bucket').some((r) =>
        (stringAttr(r, 'bucket') ?? '').includes(p.token),
      ),
  },
  passMark: 0, // set below
  checks: [
    {
      id: 'bucket',
      requirement: 'An S3 bucket resource',
      missing: 'No aws_s3_bucket resource was found.',
      matters: 'Everything else attaches to the bucket, so nothing can be checked without it.',
      run: (b) => findResources(b, 'aws_s3_bucket').length > 0,
    },
    {
      id: 'public_access_block',
      requirement: 'All four public-access-block settings turned on',
      missing:
        'aws_s3_public_access_block is missing, or not all four of block_public_acls, block_public_policy, ignore_public_acls and restrict_public_buckets are true.',
      matters:
        'Three of the four is the usual mistake, and it leaves a route open. This is the single most common cause of a leaked bucket.',
      run: (b) => {
        const [pab] = findResources(b, 'aws_s3_bucket_public_access_block');
        if (!pab) return false;
        return (
          [
            'block_public_acls',
            'block_public_policy',
            'ignore_public_acls',
            'restrict_public_buckets',
          ] as const
        ).every((k) => boolAttr(pab, k) === true);
      },
    },
    {
      id: 'encryption',
      requirement: 'Server-side encryption configured',
      missing:
        'No aws_s3_bucket_server_side_encryption_configuration with an sse_algorithm was found.',
      matters: 'Documents of this kind should not sit unencrypted at rest.',
      run: (b) => {
        const [enc] = findResources(b, 'aws_s3_bucket_server_side_encryption_configuration');
        if (!enc) return false;
        return findNested(enc, 'apply_server_side_encryption_by_default').some(
          (inner) => stringAttr(inner, 'sse_algorithm') !== null,
        );
      },
    },
    {
      id: 'versioning',
      requirement: 'Versioning enabled',
      missing: 'No aws_s3_bucket_versioning with status "Enabled" was found.',
      matters:
        'Without it, an overwrite or delete is final. The brief asked for recoverable objects.',
      run: (b) => {
        const [v] = findResources(b, 'aws_s3_bucket_versioning');
        if (!v) return false;
        const status = attrAnywhere(v, 'status');
        return status?.kind === 'string' && status.value.toLowerCase() === 'enabled';
      },
    },
    {
      id: 'tls_only',
      requirement: 'A bucket policy denying non-TLS requests',
      missing:
        'No aws_s3_bucket_policy denying requests where aws:SecureTransport is false was found.',
      matters:
        'Encryption at rest does nothing for a document read over plain HTTP. This is the half people forget.',
      run: hasDenyInsecureTransport,
    },
  ],
};

const LEAST_PRIVILEGE_ROLE: GradedTask = {
  id: 'task_least_privilege_role_v1',
  capabilities: ['least_privilege_access'],
  track: 'aws_cloud',
  title: 'Give a function the least access it can do its job with',
  timeboxMinutes: 35,
  brief: (p) => [
    'Write Terraform for an IAM role a Lambda function will assume.',
    `Name the role ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'The function reads and writes objects in one existing bucket, and writes its own logs.',
    'It must not be able to do anything else, in this account or any other.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The role is named as the brief specifies',
    missing:
      'The role name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_iam_role').some((r) => (stringAttr(r, 'name') ?? '').includes(p.token)),
  },
  passMark: 0,
  checks: [
    {
      id: 'role',
      requirement: 'An IAM role',
      missing: 'No aws_iam_role resource was found.',
      matters: 'The role is the thing being scoped.',
      run: (b) => findResources(b, 'aws_iam_role').length > 0,
    },
    {
      id: 'lambda_trust',
      requirement: 'A trust policy naming the Lambda service',
      missing: 'The role does not name lambda.amazonaws.com as the principal allowed to assume it.',
      matters:
        'A role anything can assume is not scoped at all, however careful its permissions are.',
      run: (b) => policyText(b, 'aws_iam_role').includes('lambda.amazonaws.com'),
    },
    {
      id: 'has_policy',
      requirement: 'A permissions policy attached to that role',
      missing: 'No aws_iam_role_policy or aws_iam_policy was found.',
      matters: 'A role with no policy cannot do the job it was created for.',
      run: (b) =>
        findResources(b, 'aws_iam_role_policy').length > 0 ||
        findResources(b, 'aws_iam_policy').length > 0 ||
        findResources(b, 'aws_iam_role_policy_attachment').length > 0,
    },
    {
      id: 'no_wildcard_action',
      requirement: 'No wildcard action',
      missing: 'A policy grants "*" or a service-wide wildcard such as "s3:*".',
      matters:
        'A wildcard action is the opposite of least privilege, and it is what the brief specifically ruled out.',
      run: (b) => {
        return !grantsWildcardAction(b);
      },
    },
    {
      id: 'scoped_resources',
      requirement: 'Resources scoped to something, not "*"',
      missing: 'A policy uses "*" as its resource.',
      matters:
        'Correct actions on every resource in the account is still unrestricted access to the thing that matters.',
      run: (b) => {
        // A bare "*" resource fails. Scoping logs to a log-group ARN is
        // normal and passes; it is the unqualified star the brief rules out.
        return !grantsWildcardResource(b);
      },
    },
  ],
};

/**
 * The first task written against a cloud that is not AWS.
 *
 * A prototype, and deliberately a small one: the question it answers is
 * whether this grader can mark work on another provider at all, and the
 * answer turns out to be yes with no changes to any machinery. `parseHcl`
 * and `findResources` filter HCL blocks by type and label and have never
 * known which provider a resource belongs to. Everything AWS-shaped in this
 * file is in the task definitions, not underneath them.
 *
 * The capability is the same one the AWS least-privilege task tests, and
 * that is the point rather than a coincidence. `least_privilege_access` was
 * named for what a person does, not for IAM, so an Azure task testing it is
 * offered to exactly the tracks that already need it. No new track, no
 * change to the four launch tracks, no branching in the selection code.
 *
 * What it asks for is the honest Azure equivalent of the AWS task: a managed
 * identity that can read one storage container and write its own logs, and
 * nothing else. The three ways people get this wrong on Azure are assigning
 * at subscription scope instead of the resource, reaching for Contributor or
 * Owner because they are familiar, and using a connection string rather than
 * an identity. Each is a check.
 *
 * KNOWN LIMITATION, and the reason this is a prototype rather than a slice:
 * `track` is a required field and the four values are vendor-named, so this
 * Azure task is filed under `aws_cloud`. Nothing user-facing shows it — the
 * offered-task shape carries id, title, brief, timebox and pass mark, never
 * the track — and selection is by capability. But the label is wrong, and
 * making it right means renaming the track to something like
 * `cloud_platform`, which is a stored value on every candidate profile and
 * therefore a migration and a founder decision, not a rename.
 */
const AZURE_SCOPED_IDENTITY: GradedTask = {
  id: 'task_scoped_identity_azure_v1',
  capabilities: ['least_privilege_access'],
  track: 'aws_cloud',
  title: 'Give an Azure function the least access it can do its job with',
  timeboxMinutes: 35,
  brief: (p) => [
    'Write Terraform for an Azure Function App that reads blobs from one existing storage container.',
    `Name the user-assigned managed identity ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Give it read access to that one container, and nothing else in the subscription.',
    'It must not use a storage account key or a connection string.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The managed identity is named as the brief specifies',
    missing:
      'The identity name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_user_assigned_identity').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'managed_identity',
      requirement: 'A user-assigned managed identity',
      missing: 'No azurerm_user_assigned_identity resource was found.',
      matters: 'The identity is the thing being scoped, and the alternative is a stored secret.',
      run: (b) => findResources(b, 'azurerm_user_assigned_identity').length > 0,
    },
    {
      id: 'role_assignment',
      requirement: 'A role assignment giving that identity its access',
      missing: 'No azurerm_role_assignment resource was found.',
      matters: 'Without one the identity exists and can do nothing, which is not the task.',
      run: (b) => findResources(b, 'azurerm_role_assignment').length > 0,
    },
    {
      id: 'reader_not_owner',
      requirement: 'A read-only built-in role, not Contributor or Owner',
      missing:
        'A role assignment grants Contributor, Owner or User Access Administrator. The task asks for read access to blobs.',
      matters:
        'Contributor can delete the container. Owner can grant itself anything else. Reaching for a familiar broad role is the most common way least privilege is lost on Azure.',
      run: (b) => {
        const broad = ['Contributor', 'Owner', 'User Access Administrator'];
        return !findResources(b, 'azurerm_role_assignment').some((r) => {
          const role = stringAttr(r, 'role_definition_name') ?? '';
          return broad.some((name) => role === name || role.endsWith(` ${name}`));
        });
      },
    },
    {
      id: 'scoped_assignment',
      requirement: 'Scoped to the container or storage account, not the whole subscription',
      missing:
        'A role assignment is scoped at subscription or resource-group level rather than at the storage resource.',
      matters:
        'Correct role at subscription scope is still read access to every storage account in the subscription. The scope is half of a role assignment and the half people forget.',
      run: (b) =>
        findResources(b, 'azurerm_role_assignment').every((r) => {
          const scope = rawText([r]);
          const atStorage =
            scope.includes('azurerm_storage_container') ||
            scope.includes('azurerm_storage_account');
          const atSubscription =
            /scope\s*=\s*"?\/subscriptions\/[^/"]+"?\s*$/m.test(scope) ||
            scope.includes('data.azurerm_subscription') ||
            scope.includes('azurerm_resource_group');
          return atStorage && !atSubscription;
        }),
    },
    {
      id: 'no_storage_key',
      requirement: 'No storage account key or connection string',
      missing:
        'The submission passes a storage account key, access key or connection string to the function.',
      matters:
        'A key is a long-lived secret that cannot be scoped, rotated on its own, or attributed to anybody. It is the thing a managed identity exists to replace.',
      run: (b) => {
        const text = rawText(b).toLowerCase();
        return (
          !text.includes('primary_access_key') &&
          !text.includes('primary_connection_string') &&
          !text.includes('secondary_access_key') &&
          !text.includes('accountkey=')
        );
      },
    },
  ],
};

/**
 * The second non-AWS task, and the one that tests whether the pattern holds.
 *
 * One Azure task proved the parser does not care which provider a resource
 * belongs to. It did not prove that the shape of a rubric survives a
 * genuinely different access model, and GCP's is different: there is no
 * scope attribute to inspect, because the scope is the resource type. A
 * binding on a bucket is `google_storage_bucket_iam_member`; the same role
 * granted project-wide is `google_project_iam_member`. Two resources, not
 * one resource with two values.
 *
 * The pattern held, and the check got simpler rather than harder. Azure
 * needed a regex over a scope expression to tell a container from a
 * subscription. GCP needs `findResources` twice. Nothing else in this task
 * differs in shape from the AWS or Azure ones: same identity block, same
 * five checks, same three failure modes underneath different names.
 *
 * Those three are worth naming, because they are the same three every time
 * and that is the finding:
 *
 *   too broad     roles/owner and roles/editor, as Contributor and Owner
 *                 were on Azure and a wildcard action was on AWS.
 *   too wide      granted on the project rather than the bucket, as
 *                 subscription rather than container, as "*" rather than an
 *                 ARN.
 *   long-lived    a service account key, as a storage account key, as an
 *                 access key. Every provider ships one and every provider
 *                 has something better.
 *
 * Same limitation as the Azure task: `track` is vendor-named, so this is
 * filed under `aws_cloud` and selection happens by capability. See
 * AZURE_SCOPED_IDENTITY.
 */
const GCP_SCOPED_IDENTITY: GradedTask = {
  id: 'task_scoped_identity_gcp_v1',
  capabilities: ['least_privilege_access'],
  track: 'aws_cloud',
  title: 'Give a Cloud Run service the least access it can do its job with',
  timeboxMinutes: 35,
  brief: (p) => [
    'Write Terraform for a Cloud Run service that reads objects from one existing bucket.',
    `Name the service account ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Give it read access to that one bucket, and nothing else in the project.',
    'It must not use a downloaded service account key.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The service account is named as the brief specifies',
    missing:
      'The service account name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_service_account').some((r) =>
        (stringAttr(r, 'account_id') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'service_account',
      requirement: 'A dedicated service account',
      missing: 'No google_service_account resource was found.',
      matters:
        'The default compute service account is Editor on the whole project, so using it is the opposite of this task.',
      run: (b) => findResources(b, 'google_service_account').length > 0,
    },
    {
      id: 'bucket_binding',
      requirement: 'An IAM binding on the bucket',
      missing:
        'No google_storage_bucket_iam_member or google_storage_bucket_iam_binding resource was found.',
      matters:
        'Without one the service account exists and can read nothing, which is not the task.',
      run: (b) =>
        findResources(b, 'google_storage_bucket_iam_member').length > 0 ||
        findResources(b, 'google_storage_bucket_iam_binding').length > 0,
    },
    {
      id: 'viewer_not_admin',
      requirement: 'A read-only role, not owner, editor or admin',
      missing:
        'A binding grants roles/owner, roles/editor or a storage admin role. The task asks for read access to objects.',
      matters:
        'roles/editor can delete the bucket. roles/owner can grant itself anything else. Both are the familiar choice and both are wrong here.',
      run: (b) => {
        const broad = ['roles/owner', 'roles/editor', 'roles/storage.admin'];
        const bindings = [
          ...findResources(b, 'google_storage_bucket_iam_member'),
          ...findResources(b, 'google_storage_bucket_iam_binding'),
          ...findResources(b, 'google_project_iam_member'),
          ...findResources(b, 'google_project_iam_binding'),
        ];
        return !bindings.some((r) => broad.includes(stringAttr(r, 'role') ?? ''));
      },
    },
    {
      id: 'not_project_wide',
      requirement: 'Granted on the bucket, not on the project',
      missing:
        'A role is granted at project level with google_project_iam_member or google_project_iam_binding.',
      matters:
        'The right role on the wrong scope is still read access to every bucket in the project. On GCP the scope is the resource type rather than an attribute, so this is a different resource, not a different value.',
      run: (b) =>
        findResources(b, 'google_project_iam_member').length === 0 &&
        findResources(b, 'google_project_iam_binding').length === 0,
    },
    {
      id: 'no_service_account_key',
      requirement: 'No downloaded service account key',
      missing: 'The submission creates a google_service_account_key.',
      matters:
        'A downloaded key is a long-lived credential that leaves the platform and cannot be revoked by anything watching it. Cloud Run attaches the service account directly, which is what makes the key unnecessary.',
      run: (b) => findResources(b, 'google_service_account_key').length === 0,
    },
  ],
};

/**
 * Network isolation on Azure, and the first task written to ADR 0004's step
 * one rather than to prove the grader could take it.
 *
 * The AWS task for this capability (PRIVATE_ORIGIN) asks for a bucket the
 * public reaches only through a distribution. This asks the same question
 * from the other side: a storage account nothing public reaches at all.
 *
 * Azure is a good second answer here because it has the failure mode AWS
 * does not. On S3 a bucket is private until something makes it public. An
 * Azure storage account is reachable at a public endpoint the moment it
 * exists, and `public_network_access_enabled` defaults to true. So the
 * candidate has to turn something off, not merely decline to turn it on, and
 * a submission that adds a private endpoint while leaving the public one
 * open is the common real mistake rather than a contrived one. It reads as
 * finished, it works when tested, and the account is still on the internet.
 *
 * `shared_access_key_enabled` is graded alongside because the two undo each
 * other. A private endpoint controls the route; an account key is a
 * credential that works over whichever route the caller can reach, and once
 * it is copied into a pipeline it outlives everyone who remembers it exists.
 */
const AZURE_PRIVATE_STORAGE: GradedTask = {
  id: 'task_private_storage_azure_v1',
  capabilities: ['network_isolation'],
  track: 'aws_cloud',
  title: 'Put a storage account somewhere the internet cannot reach it',
  timeboxMinutes: 35,
  brief: (p) => [
    'An internal service keeps customer documents in one Azure storage account. Nothing outside the virtual network should be able to reach it.',
    `Name the private endpoint ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Reach the account over a private endpoint in the existing subnet.',
    'The public endpoint must be off, not merely unused.',
    'Callers authenticate as themselves, never with an account key.',
    'Paste the Terraform below. Assume the resource group, virtual network and subnet already exist.',
  ],
  identity: {
    requirement: 'The private endpoint is named as the brief specifies',
    missing:
      'The private endpoint name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_private_endpoint').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'storage_account',
      requirement: 'A storage account',
      missing: 'No azurerm_storage_account resource was found.',
      matters: 'It is the thing being isolated, and everything else here describes how.',
      run: (b) => findResources(b, 'azurerm_storage_account').length > 0,
    },
    {
      id: 'private_endpoint',
      requirement: 'A private endpoint connected to that account',
      missing:
        'No azurerm_private_endpoint with a private_service_connection block was found. An endpoint without one is attached to nothing.',
      matters:
        'This is what gives the account an address inside the virtual network. Without it, turning the public endpoint off leaves the account unreachable by anything, which is isolation by breakage rather than by design.',
      run: (b) =>
        findResources(b, 'azurerm_private_endpoint').some(
          (e) => findNested(e, 'private_service_connection').length > 0,
        ),
    },
    {
      id: 'public_endpoint_off',
      requirement: 'Public network access is disabled on the account',
      missing:
        'public_network_access_enabled is absent or true. On Azure the public endpoint exists by default, so leaving this out leaves it on.',
      matters:
        'This is the check the task turns on. A private endpoint adds a private route; it does not remove the public one. An account with both is reachable from the internet by anyone holding a credential, and the private endpoint in the diagram says otherwise.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some(
          (a) => boolAttr(a, 'public_network_access_enabled') === false,
        ),
    },
    {
      id: 'default_deny',
      requirement: 'The account network rules default to Deny',
      missing: 'No network_rules with default_action = "Deny" was found. The default is Allow.',
      matters:
        'Defence in depth against the previous check being changed later. A default of Allow means any future rule addition opens the account rather than narrowing it, and that edit rarely comes back for review.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'network_rules').some(
            (r) => (stringAttr(r, 'default_action') ?? '').toLowerCase() === 'deny',
          ),
        ),
    },
    {
      id: 'no_account_key',
      requirement: 'Shared account key access is disabled',
      missing: 'shared_access_key_enabled is absent or true.',
      matters:
        'An account key is one string that grants everything in the account, cannot be scoped, and is identical for every caller holding it. It travels over whichever route reaches the account, so it undoes the isolation above the moment it is pasted somewhere with a route.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some(
          (a) => boolAttr(a, 'shared_access_key_enabled') === false,
        ),
    },
  ],
};

/**
 * Network isolation on GCP, and the pair to the Azure task above.
 *
 * A managed database rather than object storage, deliberately. GCP's storage
 * buckets are private by default in the way S3 is, so a bucket task would
 * have restated the AWS one in a different vocabulary. Cloud SQL is where
 * GCP's version of this decision actually lives, and it is the resource
 * people most often expose without meaning to.
 *
 * The distinctive failure here is not a forgotten toggle. It is
 * `authorized_networks`, which is a real feature with a legitimate use and
 * an obvious wrong answer: adding 0.0.0.0/0 makes the instance work from
 * anywhere, immediately, and looks like configuration rather than like
 * disabling a control. A submission can have `ipv4_enabled = false`
 * elsewhere and still ship that line, which is why both are graded and why
 * the open-range check is worth its own row.
 */
const GCP_PRIVATE_DATABASE: GradedTask = {
  id: 'task_private_database_gcp_v1',
  capabilities: ['network_isolation'],
  track: 'aws_cloud',
  title: 'Put a database somewhere the internet cannot reach it',
  timeboxMinutes: 35,
  brief: (p) => [
    'An internal service needs a Cloud SQL Postgres instance. Nothing outside the VPC should be able to connect to it.',
    `Name the instance ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Give it a private address on the existing network, and no public one.',
    'Do not open it to a range of addresses instead.',
    'Connections must be encrypted.',
    'Paste the Terraform below. Assume the VPC and its private services connection already exist.',
  ],
  identity: {
    requirement: 'The instance is named as the brief specifies',
    missing:
      'The instance name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_sql_database_instance').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'sql_instance',
      requirement: 'A Cloud SQL instance',
      missing: 'No google_sql_database_instance resource was found.',
      matters: 'It is the thing being isolated, and everything else here describes how.',
      run: (b) => findResources(b, 'google_sql_database_instance').length > 0,
    },
    {
      id: 'no_public_ip',
      requirement: 'The instance has no public address',
      missing:
        'ipv4_enabled is absent or true in ip_configuration, so the instance is given a public address.',
      matters:
        'This is the check the task turns on. A public address means the instance is on the internet and only its password stands between a scanner and the data. Cloud SQL hands one out unless told not to.',
      run: (b) =>
        findResources(b, 'google_sql_database_instance').some((i) =>
          findNested(i, 'ip_configuration').some((c) => boolAttr(c, 'ipv4_enabled') === false),
        ),
    },
    {
      id: 'private_network',
      requirement: 'The instance is attached to a network privately',
      missing: 'No private_network was set in ip_configuration.',
      matters:
        'Without it, removing the public address leaves nothing able to connect at all. This is the half that makes the instance reachable by the things that should reach it.',
      run: (b) =>
        findResources(b, 'google_sql_database_instance').some(
          (i) => attrAnywhere(i, 'private_network') !== null,
        ),
    },
    {
      id: 'no_open_authorized_network',
      disqualifying: true,
      remedy:
        'Remove the 0.0.0.0/0 entry and connect over the private network instead, then submit again. If this range is live somewhere, treat the instance as having been publicly reachable for as long as it stood.',
      requirement: 'No authorized network covers the whole internet',
      missing:
        'An authorized_networks block allows 0.0.0.0/0, which permits every address there is.',
      matters:
        'The interesting wrong answer. It is a supported feature, it is one line, and it makes the connection problem disappear during testing. A reviewer skimming for ipv4_enabled will not see it, and the instance is open to everything with a password guesser.',
      run: (b) => {
        const instances = findResources(b, 'google_sql_database_instance');
        const ranges = instances.flatMap((i) =>
          findNested(i, 'authorized_networks').map((n) => stringAttr(n, 'value') ?? ''),
        );
        // The same two ranges the AWS security-group tasks refuse, read from
        // the shared constant rather than repeated. Two copies of "what open
        // to the internet means" is two places to fix when a third spelling
        // turns up.
        return !ranges.some((r) => OPEN_TO_THE_WORLD.includes(r.trim()));
      },
    },
    {
      id: 'encrypted_connections',
      requirement: 'Connections are required to be encrypted',
      missing:
        'Neither require_ssl = true nor an ssl_mode requiring encryption was found in ip_configuration.',
      matters:
        'A private network limits who can open a connection. It does not encrypt what travels over one, and anything already inside the VPC reads an unencrypted session in full.',
      run: (b) =>
        findResources(b, 'google_sql_database_instance').some((i) =>
          findNested(i, 'ip_configuration').some((c) => {
            if (boolAttr(c, 'require_ssl') === true) return true;
            const mode = (stringAttr(c, 'ssl_mode') ?? '').toUpperCase();
            return mode === 'ENCRYPTED_ONLY' || mode === 'TRUSTED_CLIENT_CERTIFICATE_REQUIRED';
          }),
        ),
    },
  ],
};

/**
 * Observability on Azure, paired with the GCP task below and answering the
 * same question as ALARM_THAT_FIRES on AWS: does anybody actually hear this?
 *
 * The AWS task turns on `treat_missing_data`, because CloudWatch's default
 * leaves an alarm quiet through a total outage. Azure's version of "the
 * alert fires and nothing happens" is somewhere else entirely, which is why
 * this is a different rubric rather than the same one translated.
 *
 * On Azure the alert and the people it reaches are two separate resources.
 * An action group is valid, deployable and referenceable with no receiver in
 * it at all. So the failure is not a default left alone; it is a resource
 * that exists, is wired up correctly, appears in the plan, and delivers to
 * nobody. Everything looks connected because everything is connected. The
 * last hop is missing and nothing reports that as an error.
 *
 * `window_size` is graded with it for the reason the AWS task grades
 * datapoints: an alert that reaches a person for every single bad minute
 * gets muted by that person within a week, and a muted alert and no alert
 * are the same alert.
 */
const AZURE_ALERT_REACHES_SOMEBODY: GradedTask = {
  id: 'task_alert_reaches_somebody_azure_v1',
  capabilities: ['observability_and_alerting'],
  track: 'aws_cloud',
  title: 'Raise an Azure alert that actually reaches a person',
  timeboxMinutes: 35,
  brief: (p) => [
    'An App Service is in production and nobody is watching its failure rate.',
    `Name the metric alert ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Alert when HTTP server errors climb.',
    'It has to reach a human being, not just turn a tile red.',
    'A single bad minute is a blip. Do not page somebody for it.',
    'Paste the Terraform below. Assume the App Service and resource group already exist.',
  ],
  identity: {
    requirement: 'The metric alert is named as the brief specifies',
    missing:
      'The alert name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_monitor_metric_alert').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'alert_on_a_metric',
      requirement: 'A metric alert with a scope and a criteria block',
      missing: 'No azurerm_monitor_metric_alert with both scopes and a criteria block was found.',
      matters:
        'An alert has to say what it watches and what counts as wrong. Neither is inferred, and a criteria block with no scope watches nothing.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_metric_alert').some(
          (a) => attrAnywhere(a, 'scopes') !== null && findNested(a, 'criteria').length > 0,
        ),
    },
    {
      id: 'action_group_exists',
      requirement: 'An action group',
      missing: 'No azurerm_monitor_action_group resource was found.',
      matters:
        'On Azure the alert and its recipients are separate resources. Without this one, the alert has nowhere to send anything.',
      run: (b) => findResources(b, 'azurerm_monitor_action_group').length > 0,
    },
    {
      id: 'alert_is_wired_to_it',
      requirement: 'The alert references an action group',
      missing: 'No action block with an action_group_id was found on the metric alert.',
      matters:
        'An action group that exists and is not referenced changes nothing. The alert still fires into a dashboard nobody has open.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_metric_alert').some((a) =>
          findNested(a, 'action').some((x) => attrAnywhere(x, 'action_group_id') !== null),
        ),
    },
    {
      id: 'somebody_is_actually_in_it',
      requirement: 'The action group has at least one receiver',
      missing:
        'The action group contains no email_receiver, sms_receiver, webhook_receiver, azure_app_push_receiver or event_hub_receiver block.',
      matters:
        'This is the check the task turns on. An empty action group is valid Terraform, deploys cleanly, and satisfies every reference to it. The alert fires, the action group runs, and it delivers to nobody. Nothing in the plan, the portal or the alert history reports that as a problem.',
      run: (b) => {
        const receivers = [
          'email_receiver',
          'sms_receiver',
          'webhook_receiver',
          'azure_app_push_receiver',
          'event_hub_receiver',
          'arm_role_receiver',
          'logic_app_receiver',
          'automation_runbook_receiver',
          'voice_receiver',
        ];
        return findResources(b, 'azurerm_monitor_action_group').some((g) =>
          receivers.some((r) => findNested(g, r).length > 0),
        );
      },
    },
    {
      id: 'window_covers_more_than_a_blip',
      requirement: 'The evaluation window covers more than a single sample',
      missing: 'window_size is absent or is one minute, so a single bad minute pages somebody.',
      matters:
        'An alert that fires on every blip gets muted, and a muted alert is indistinguishable from no alert. The window is what makes the difference between "this is broken" and "this was briefly slow".',
      run: (b) =>
        findResources(b, 'azurerm_monitor_metric_alert').some((a) => {
          const minutes = isoMinutes(stringAttr(a, 'window_size'));
          return minutes !== null && minutes > 1;
        }),
    },
  ],
};

/**
 * Observability on GCP, and the closest of the three to the AWS task it
 * pairs with, for a reason worth recording.
 *
 * `evaluation_missing_data` is GCP's `treat_missing_data`, and it has the
 * same default and the same consequence: left alone, a policy watching an
 * error count does nothing at all when the service stops emitting, because
 * no data is not the same as data above a threshold. The service is dead,
 * the graph is empty, the policy is quiet.
 *
 * That the identical trap exists under a different attribute name on a
 * different provider is the strongest evidence for ADR 0004's thesis in the
 * whole task set. It is not one vendor's quirk being tested three times; it
 * is a property of how alerting works, and a candidate who understands it on
 * one cloud has something transferable rather than a memorised attribute.
 *
 * The notification channel is graded separately, as on Azure, because GCP
 * has its own version of the silent gap: `notification_channels` is an
 * ordinary list attribute, and a policy with an empty one is valid and
 * evaluates forever without telling anybody.
 */
const GCP_ALERT_SURVIVES_SILENCE: GradedTask = {
  id: 'task_alert_survives_silence_gcp_v1',
  capabilities: ['observability_and_alerting'],
  track: 'aws_cloud',
  title: 'Raise a GCP alert that still fires when the service goes quiet',
  timeboxMinutes: 35,
  brief: (p) => [
    'A Cloud Run service publishes a request error count. Nobody is watching it.',
    `Name the alert policy ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Alert when errors climb, and make sure it reaches a person.',
    'The hardest case is not the service failing. It is the service stopping, and publishing nothing at all. Handle that one.',
    'A single bad sample is a blip. Do not page somebody for it.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The alert policy is named as the brief specifies',
    missing:
      'The display name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_monitoring_alert_policy').some((a) =>
        (stringAttr(a, 'display_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'policy_with_a_condition',
      requirement: 'An alert policy with a condition',
      missing:
        'No google_monitoring_alert_policy with a conditions block was found. A policy with no condition never evaluates anything.',
      matters:
        'The condition is the entire statement of what counts as wrong. A policy without one is a name and a combiner.',
      run: (b) =>
        findResources(b, 'google_monitoring_alert_policy').some(
          (a) => findNested(a, 'conditions').length > 0,
        ),
    },
    {
      id: 'notification_channel_exists',
      requirement: 'A notification channel',
      missing: 'No google_monitoring_notification_channel resource was found.',
      matters:
        'The policy decides when to speak. The channel decides who hears it, and it is a separate resource that is easy to leave for later and never come back to.',
      run: (b) => findResources(b, 'google_monitoring_notification_channel').length > 0,
    },
    {
      id: 'policy_is_wired_to_it',
      requirement: 'The policy lists a notification channel',
      missing: 'notification_channels is absent or empty on the alert policy.',
      matters:
        'An empty list is valid and the policy evaluates normally with it. The incident opens in the console and no one is told, which looks identical to nothing being wrong.',
      run: (b) =>
        findResources(b, 'google_monitoring_alert_policy').some((a) => {
          const v = a.attributes['notification_channels'];
          if (!v) return false;
          if (v.kind === 'list') return v.items.length > 0;
          // A reference or interpolation to a channel is the usual spelling
          // and cannot be counted, only recognised as non-empty.
          return true;
        }),
    },
    {
      id: 'no_data_still_fires',
      requirement: 'Missing data is treated as a reason to fire',
      missing:
        'evaluation_missing_data is absent or set to EVALUATION_MISSING_DATA_NO_OP, so a service that stops publishing never triggers this policy.',
      matters:
        'This is the check the task turns on, and it is the same trap CloudWatch sets with treat_missing_data. An error-rate policy is quiet during a total outage, because a dead service reports no errors. The graph is empty rather than red, and empty is the default for doing nothing.',
      run: (b) =>
        findResources(b, 'google_monitoring_alert_policy').some((a) => {
          const v = attrAnywhere(a, 'evaluation_missing_data');
          const text = v && v.kind === 'string' ? v.value.toUpperCase() : '';
          return (
            text === 'EVALUATION_MISSING_DATA_ACTIVE' || text === 'EVALUATION_MISSING_DATA_INACTIVE'
          );
        }),
    },
    {
      id: 'condition_holds_not_spikes',
      requirement: 'The condition holds for longer than a single sample',
      missing: 'duration is absent or zero on the condition, so one bad sample opens an incident.',
      matters:
        'An alert that fires on every blip gets muted, and a muted alert is indistinguishable from no alert. On GCP the duration is what separates a spike from a state.',
      run: (b) =>
        findResources(b, 'google_monitoring_alert_policy').some((a) => {
          const v = attrAnywhere(a, 'duration');
          if (!v || v.kind !== 'string') return false;
          const seconds = Number.parseInt(v.value.replace(/s$/i, ''), 10);
          return Number.isFinite(seconds) && seconds > 0;
        }),
    },
  ],
};

/**
 * Failure handling on Azure, paired with RELIABLE_QUEUE on AWS.
 *
 * SQS has no dead-letter queue until you make one. Service Bus always has
 * one, which sounds like the safer default and sets a subtler trap: because
 * the dead-letter subqueue is always there, people assume everything that
 * goes wrong ends up in it.
 *
 * Expiry does not. `dead_lettering_on_message_expiration` is false by
 * default, so a message that outlives its time to live is deleted outright,
 * and the deletion is the normal, documented behaviour rather than an error.
 * Nothing is logged as lost. The queue drains, the graph looks healthy, and
 * the work is gone - which is the same ending as the SQS task, reached by
 * the opposite route.
 *
 * TTL is graded alongside because the two only work as a pair. A queue with
 * expiry dead-lettering on and no TTL never expires anything, and a TTL with
 * the flag off is the fastest way to delete work on a schedule.
 */
const AZURE_QUEUE_LOSES_NOTHING: GradedTask = {
  id: 'task_queue_loses_nothing_azure_v1',
  capabilities: ['failure_handling'],
  track: 'aws_cloud',
  title: 'Take work off a queue without losing any of it',
  timeboxMinutes: 35,
  brief: (p) => [
    'Orders arrive on a Service Bus queue and a worker processes them. Some orders fail, and some sit unprocessed while the worker is down.',
    `Name the queue ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'A message that fails repeatedly must end up somewhere a person can look at it, not be retried forever.',
    'Messages must not live on the queue indefinitely.',
    'A message that runs out of time must also be findable afterwards. It must not simply disappear.',
    'The worker takes about thirty seconds per message. Do not let a message be handed to a second worker while the first is still on it.',
    'Paste the Terraform below. Assume the namespace already exists.',
  ],
  identity: {
    requirement: 'The queue is named as the brief specifies',
    missing:
      'The queue name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_servicebus_queue').some((q) =>
        (stringAttr(q, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'queue_exists',
      requirement: 'A Service Bus queue',
      missing: 'No azurerm_servicebus_queue resource was found.',
      matters: 'Everything else here is a property of the queue.',
      run: (b) => findResources(b, 'azurerm_servicebus_queue').length > 0,
    },
    {
      id: 'bounded_retries',
      requirement: 'A delivery count that stops the retrying',
      missing: 'max_delivery_count was not set on the queue.',
      matters:
        'Without a stated limit the queue keeps handing the same failing message back to the worker. It is the message that never completes and never goes away, and it holds up everything behind it.',
      run: (b) =>
        findResources(b, 'azurerm_servicebus_queue').some((q) => {
          const count = numberAttr(q, 'max_delivery_count');
          return count !== null && count > 1;
        }),
    },
    {
      id: 'messages_expire',
      requirement: 'Messages have a time to live',
      missing: 'default_message_ttl was not set on the queue.',
      matters:
        'An order nobody processed three weeks ago is not an order any more. Without a TTL it stays queued forever and is eventually processed by a worker that has no idea how old it is.',
      run: (b) =>
        findResources(b, 'azurerm_servicebus_queue').some(
          (q) => attrText(q, 'default_message_ttl').trim().length > 0,
        ),
    },
    {
      id: 'expiry_is_not_deletion',
      requirement: 'An expired message is dead-lettered rather than dropped',
      missing:
        'dead_lettering_on_message_expiration is absent or false, so a message that outlives its TTL is deleted outright.',
      matters:
        'This is the check the task turns on, and it is the one people miss precisely because Service Bus always has a dead-letter subqueue. Having one is not the same as everything reaching it. Expiry is the path that skips it by default, so a TTL added for good reasons quietly becomes a scheduled delete, and nothing reports the work as lost.',
      run: (b) =>
        findResources(b, 'azurerm_servicebus_queue').some(
          (q) => boolAttr(q, 'dead_lettering_on_message_expiration') === true,
        ),
    },
    {
      id: 'lock_outlasts_the_work',
      requirement: 'The lock is held longer than the work takes',
      missing:
        'lock_duration is absent or shorter than the thirty seconds the brief says a message takes.',
      matters:
        'A lock that expires mid-processing hands the message to a second worker while the first is still on it. The order is processed twice, and both attempts count toward the delivery limit, so a queue that is working correctly dead-letters messages that never actually failed.',
      run: (b) =>
        findResources(b, 'azurerm_servicebus_queue').some((q) => {
          const seconds = isoSeconds(stringAttr(q, 'lock_duration'));
          return seconds !== null && seconds >= 30;
        }),
    },
  ],
};

/**
 * Failure handling on GCP, and the one with the sharpest ending of the
 * three.
 *
 * Pub/Sub's dead-letter policy is opt-in like SQS's, so half of this task is
 * the same shape as the AWS one. The half that is not is the reason it is
 * worth writing.
 *
 * A dead-letter topic is a topic. Topics do not store anything; subscriptions
 * do. A dead-letter topic with no subscription attached accepts every failed
 * message and drops all of them, and it does so while the configuration reads
 * as correct: the policy is set, the topic exists, the reference resolves,
 * and the console shows messages being dead-lettered. There is no error at
 * any point. The messages simply have nowhere to be.
 *
 * That is a worse outcome than having no dead-letter policy at all, because
 * with no policy somebody eventually notices the redelivery. Here the queue
 * drains cleanly and the evidence is destroyed on the way out.
 */
const GCP_DEAD_LETTER_ACTUALLY_KEEPS: GradedTask = {
  id: 'task_dead_letter_actually_keeps_gcp_v1',
  capabilities: ['failure_handling'],
  track: 'aws_cloud',
  title: 'Send failed messages somewhere they are actually kept',
  timeboxMinutes: 35,
  brief: (p) => [
    'Events arrive on a Pub/Sub topic and a worker handles them. Some events fail every time they are tried.',
    `Name the main subscription ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'After a few failed attempts, a message must be set aside rather than retried forever.',
    'Somebody has to be able to go and read those messages afterwards. Make sure they are still there to read.',
    'Do not retry instantly in a tight loop.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The subscription is named as the brief specifies',
    missing:
      'The subscription name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_pubsub_subscription').some((s) =>
        (stringAttr(s, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'subscription_exists',
      requirement: 'A subscription on a topic',
      missing: 'No google_pubsub_subscription with a topic was found.',
      matters:
        'A topic on its own delivers to nobody and stores nothing. The subscription is what makes a message wait for a worker.',
      run: (b) =>
        findResources(b, 'google_pubsub_subscription').some(
          (s) => attrText(s, 'topic').trim().length > 0,
        ),
    },
    {
      id: 'dead_letter_policy',
      requirement: 'A dead-letter policy naming a topic',
      missing: 'No dead_letter_policy with a dead_letter_topic was found on the subscription.',
      matters:
        'Without it a permanently failing message is redelivered until the retention window ends and is then dropped. Nothing records that it existed.',
      run: (b) =>
        findResources(b, 'google_pubsub_subscription').some((s) =>
          findNested(s, 'dead_letter_policy').some(
            (d) => attrText(d, 'dead_letter_topic').trim().length > 0,
          ),
        ),
    },
    {
      id: 'bounded_attempts',
      requirement: 'A limit on delivery attempts',
      missing: 'max_delivery_attempts was not set in the dead_letter_policy.',
      matters:
        'The policy only takes effect once a message has been tried a stated number of times. Without the number, nothing is ever handed over to it.',
      run: (b) =>
        findResources(b, 'google_pubsub_subscription').some((s) =>
          findNested(s, 'dead_letter_policy').some((d) => {
            const attempts = numberAttr(d, 'max_delivery_attempts');
            return attempts !== null && attempts > 0;
          }),
        ),
    },
    {
      id: 'dead_letter_topic_is_read',
      requirement: 'The dead-letter topic has a subscription of its own',
      missing:
        'No subscription was found on the topic named as the dead_letter_topic, so messages sent there are accepted and then dropped.',
      matters:
        'This is the check the task turns on, and it fails silently in the worst way available. A topic stores nothing; only a subscription does. Every failed message is delivered to the dead-letter topic, counted as dead-lettered, and discarded, while the policy, the reference and the metrics all read as correct. It is worse than having no dead-letter policy, because that at least keeps redelivering until somebody notices.',
      run: (b) => {
        const subscriptions = findResources(b, 'google_pubsub_subscription');
        const deadTopics = subscriptions
          .flatMap((s) => findNested(s, 'dead_letter_policy'))
          .map((d) => attrText(d, 'dead_letter_topic'))
          .map((text) => /google_pubsub_topic\.(\w+)/.exec(text)?.[1])
          .filter((label): label is string => label !== undefined);
        if (deadTopics.length === 0) return false;
        // A subscription counts as reading the dead-letter topic when its own
        // `topic` points at the same topic resource the policy names.
        return deadTopics.some((label) =>
          subscriptions.some((s) =>
            new RegExp(`google_pubsub_topic\\.${label}\\b`).test(attrText(s, 'topic')),
          ),
        );
      },
    },
    {
      id: 'backs_off_between_tries',
      requirement: 'A retry policy rather than an immediate loop',
      missing: 'No retry_policy with a minimum_backoff was found on the subscription.',
      matters:
        'The default redelivers as fast as the worker nacks. A dependency that is briefly down is then hit at full rate by every message at once, which is how a short outage becomes a long one.',
      run: (b) =>
        findResources(b, 'google_pubsub_subscription').some((s) =>
          findNested(s, 'retry_policy').some(
            (r) => attrText(r, 'minimum_backoff').trim().length > 0,
          ),
        ),
    },
  ],
};

/**
 * Durability on Azure, and a task about the gap between "I turned on soft
 * delete" and "I can get this back".
 *
 * Blob soft delete is the well-known setting and it protects exactly one
 * thing: a blob being deleted. It does nothing about the container being
 * deleted, and deleting a container takes every blob inside it with it.
 * Somebody who has enabled blob soft delete and stops there has protected
 * against the small accident and not the large one, which is the wrong way
 * round.
 *
 * Above both sits the account. Neither retention policy survives the storage
 * account being removed, and on Azure the thing that prevents that is not a
 * storage setting at all - it is a management lock, a separate resource in a
 * different part of the provider that most storage tutorials never mention.
 *
 * Three levels, three separate mechanisms, and the ones people know about
 * are the two that matter least.
 */
const AZURE_RECOVERABLE_STORAGE: GradedTask = {
  id: 'task_recoverable_storage_azure_v1',
  capabilities: ['durability_and_recovery'],
  track: 'aws_cloud',
  title: 'Make a storage account you cannot lose by accident',
  timeboxMinutes: 40,
  brief: (p) => [
    'A storage account holds the only copy of several years of signed contracts.',
    `Name the storage account so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Overwriting a file must not destroy what was there before.',
    'Deleting a file must be recoverable.',
    'Deleting the container the files are in must also be recoverable.',
    'Nobody should be able to delete the account itself without deliberately removing the protection first.',
    'Paste the Terraform below. Assume the resource group already exists.',
  ],
  identity: {
    requirement: 'The storage account is named as the brief specifies',
    missing:
      'The storage account name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_storage_account').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'account_holding_the_only_copy',
      requirement: 'A storage account',
      missing: 'No azurerm_storage_account resource was found.',
      matters: 'Everything else here is a property of it, or a guard placed over it.',
      run: (b) => findResources(b, 'azurerm_storage_account').length > 0,
    },
    {
      id: 'overwrites_keep_history',
      requirement: 'Blob versioning is enabled',
      missing: 'versioning_enabled was not set to true in blob_properties.',
      matters:
        'Without it, writing to an existing blob replaces it and the previous content is gone. Soft delete does not cover this: nothing was deleted, so nothing is retained. It is the quietest way to lose a document, because the file is still there and still the right size.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'blob_properties').some((p) => boolAttr(p, 'versioning_enabled') === true),
        ),
    },
    {
      id: 'deleted_blobs_recoverable',
      requirement: 'A blob delete retention policy',
      missing: 'No delete_retention_policy with a day count was found in blob_properties.',
      matters:
        'The familiar half of the answer. It buys a window in which a deleted file can be brought back, and without it a delete is immediate and final.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'blob_properties').some((p) =>
            findNested(p, 'delete_retention_policy').some((d) => {
              const days = numberAttr(d, 'days');
              return days !== null && days > 0;
            }),
          ),
        ),
    },
    {
      id: 'deleted_containers_recoverable',
      requirement: 'A container delete retention policy',
      missing:
        'No container_delete_retention_policy with a day count was found in blob_properties.',
      matters:
        'This is the check the task turns on. Blob soft delete does not apply when the container goes, and deleting a container takes every blob in it at once. The person who enabled blob soft delete believes they are covered, and they are covered against losing one file rather than against losing all of them.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'blob_properties').some((p) =>
            findNested(p, 'container_delete_retention_policy').some((d) => {
              const days = numberAttr(d, 'days');
              return days !== null && days > 0;
            }),
          ),
        ),
    },
    {
      id: 'account_cannot_be_deleted',
      requirement: 'A management lock preventing deletion',
      missing: 'No azurerm_management_lock with lock_level CanNotDelete or ReadOnly was found.',
      matters:
        'Both retention policies live inside the account and neither outlives it. On Azure the protection against removing the account is a management lock, which is a separate resource in a different part of the provider than every storage setting above, so it is the one people writing a storage module never reach for.',
      run: (b) =>
        findResources(b, 'azurerm_management_lock').some((l) => {
          const level = (stringAttr(l, 'lock_level') ?? '').toLowerCase();
          return level === 'cannotdelete' || level === 'readonly';
        }),
    },
  ],
};

/**
 * Durability on GCP, and the only task in the set where the wrong answer is
 * a feature working exactly as documented.
 *
 * Versioning and a retention policy are the two halves people reach for, and
 * both have a catch. A retention policy that is not locked can be shortened
 * or removed by anybody who can edit the bucket, which is the same person who
 * would delete the data, so unlocked it protects against accident and not
 * against intent or against a compromised account.
 *
 * The lifecycle rule is worse, and it is the reason this task grades one
 * check as disqualifying. `with_state` defaults to ANY. A rule written to
 * tidy up old versions, with an age condition and a Delete action and no
 * state, deletes live objects on their birthday. It is not a misconfiguration
 * that fails loudly. It runs on schedule, deletes exactly what it was told
 * to, and reports success, and the bucket empties over months while every
 * setting above it reads as correct.
 */
const GCP_BUCKET_KEEPS_WHAT_IT_HOLDS: GradedTask = {
  id: 'task_bucket_keeps_what_it_holds_gcp_v1',
  capabilities: ['durability_and_recovery'],
  track: 'aws_cloud',
  title: 'Keep a bucket that cannot be quietly emptied',
  timeboxMinutes: 40,
  brief: (p) => [
    'A bucket holds the only copy of several years of signed contracts.',
    `Name the bucket so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Overwriting or deleting an object must not destroy what was there before.',
    'The objects must be retained for a fixed period, and somebody with permission to edit the bucket must not be able to simply shorten that period.',
    'If you add any tidying-up rules, be certain about what they delete.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The bucket is named as the brief specifies',
    missing:
      'The bucket name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_storage_bucket').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'bucket_exists',
      requirement: 'A bucket',
      missing: 'No google_storage_bucket resource was found.',
      matters: 'Everything else here is a property of it.',
      run: (b) => findResources(b, 'google_storage_bucket').length > 0,
    },
    {
      id: 'versioning_on',
      requirement: 'Object versioning is enabled',
      missing: 'No versioning block with enabled = true was found.',
      matters:
        'Without it, a write to an existing object replaces it and a delete removes it, both immediately and both unrecoverably. On GCP this is the single setting that turns destruction into a new version.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'versioning').some((v) => boolAttr(v, 'enabled') === true),
        ),
    },
    {
      id: 'retention_period',
      requirement: 'A retention policy with a period',
      missing: 'No retention_policy with a retention_period was found.',
      matters:
        'Versioning keeps what was overwritten. Retention is what stops the versions themselves being cleared out, and it is the half that answers "for how long".',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'retention_policy').some((p) => {
            const period = numberAttr(p, 'retention_period');
            return period !== null && period > 0;
          }),
        ),
    },
    {
      id: 'retention_is_locked',
      requirement: 'The retention policy is locked',
      missing: 'is_locked was not set to true on the retention_policy.',
      matters:
        'An unlocked policy can be shortened or removed by anybody who can edit the bucket, and that is the same person who could delete the data. It protects against a mistake and not against a decision or a stolen credential. Locking it is deliberately irreversible, which is the entire point of it.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'retention_policy').some((p) => boolAttr(p, 'is_locked') === true),
        ),
    },
    {
      id: 'no_rule_deletes_live_objects',
      disqualifying: true,
      remedy:
        'Add condition { with_state = "ARCHIVED" } to any lifecycle rule whose action is Delete, then submit again. If this rule is live somewhere, check what it has already removed before assuming nothing was lost.',
      requirement: 'No lifecycle rule deletes live objects',
      missing:
        'A lifecycle_rule has a Delete action without with_state = "ARCHIVED", so it applies to current objects as well as old versions.',
      matters:
        'The one wrong answer here that works perfectly. with_state defaults to ANY, so a rule meant to tidy old versions deletes live objects the day they reach the stated age. Nothing errors. The rule runs on schedule, deletes what it was told to, and reports success, while versioning and retention above it still read as correct and the bucket empties over months.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').every((r) =>
          findNested(r, 'lifecycle_rule').every((rule) => {
            const deletes = findNested(rule, 'action').some(
              (a) => (stringAttr(a, 'type') ?? '').toLowerCase() === 'delete',
            );
            if (!deletes) return true;
            return findNested(rule, 'condition').some(
              (c) => (stringAttr(c, 'with_state') ?? '').toUpperCase() === 'ARCHIVED',
            );
          }),
        ),
    },
  ],
};

/**
 * Cost control on Azure, and the sixth capability the aws_cloud track needs
 * before its label can honestly change.
 *
 * A budget on any cloud is a notification, not a limit. None of the three
 * providers will stop spending for you, so the only thing a budget buys is
 * time to react, and everything about whether it is useful comes down to
 * whether that time is longer than zero.
 *
 * Azure's version of getting this wrong is `threshold_type`. It defaults to
 * Actual, and an Actual notification at ninety percent tells you that you
 * have already spent ninety percent. On a bill that grows steadily, that
 * arrives with a few days in hand. On a runaway - a loop, a misconfigured
 * autoscale, a job retrying forever - the difference between ninety and a
 * hundred percent is hours, and the alert lands after the money is gone.
 *
 * Forecasted is the same notification asked a different question: not what
 * has been spent, but what this month is going to cost if nothing changes.
 * It is one attribute, most people never set it, and it is the whole
 * difference between a budget that works and a receipt.
 */
const AZURE_BUDGET_WARNS_IN_TIME: GradedTask = {
  id: 'task_budget_warns_in_time_azure_v1',
  capabilities: ['cost_control'],
  track: 'aws_cloud',
  title: 'Hear about the bill while you can still do something about it',
  timeboxMinutes: 30,
  brief: (p) => [
    'A team runs everything in one Azure resource group and nobody notices the cost until the invoice arrives.',
    `Name the budget ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Set a monthly limit and make sure a person is told about it.',
    'Being told once the money is already spent is not useful. Somebody has to hear in time to act.',
    'Paste the Terraform below. Assume the resource group already exists.',
  ],
  identity: {
    requirement: 'The budget is named as the brief specifies',
    missing:
      'The budget name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) => budgetBlocks(b).some((x) => (stringAttr(x, 'name') ?? '').includes(p.token)),
  },
  passMark: 0,
  checks: [
    {
      id: 'budget_exists',
      requirement: 'A consumption budget',
      missing:
        'No azurerm_consumption_budget_resource_group or azurerm_consumption_budget_subscription resource was found.',
      matters: 'Everything else here is a property of it.',
      run: (b) => budgetBlocks(b).length > 0,
    },
    {
      id: 'budget_has_an_amount',
      requirement: 'An amount and a monthly period',
      missing: 'No amount was set, or time_grain is not Monthly.',
      matters:
        'A budget with no number is a name. The grain matters as much as the number: the same amount read annually is a twelfth as strict, and it is the default nobody checks.',
      run: (b) =>
        budgetBlocks(b).some((x) => {
          const amount = numberAttr(x, 'amount');
          const grain = (stringAttr(x, 'time_grain') ?? 'Monthly').toLowerCase();
          return amount !== null && amount > 0 && grain === 'monthly';
        }),
    },
    {
      id: 'budget_reaches_a_person',
      requirement: 'A notification with somebody to send to',
      missing:
        'No notification block with contact_emails, contact_groups or contact_roles was found.',
      matters:
        'A notification with no recipients is evaluated on schedule and delivered nowhere, which is the same cost overrun with an extra resource in the plan.',
      run: (b) =>
        budgetBlocks(b).some((x) =>
          findNested(x, 'notification').some(
            (n) =>
              attrText(n, 'contact_emails').trim().length > 0 ||
              attrText(n, 'contact_groups').trim().length > 0 ||
              attrText(n, 'contact_roles').trim().length > 0,
          ),
        ),
    },
    {
      id: 'forecast_not_just_actual',
      requirement: 'At least one notification is on forecast rather than actual spend',
      missing:
        'No notification sets threshold_type = "Forecasted". The default is Actual, which reports money already spent.',
      matters:
        'This is the check the task turns on. An Actual notification at ninety percent says you have spent ninety percent, which on a runaway is hours of warning and often none. Forecasted asks what the month will cost if nothing changes, and it is the difference between an alert and a receipt.',
      run: (b) =>
        budgetBlocks(b).some((x) =>
          findNested(x, 'notification').some(
            (n) => (stringAttr(n, 'threshold_type') ?? '').toLowerCase() === 'forecasted',
          ),
        ),
    },
    {
      id: 'warns_below_the_limit',
      requirement: 'A threshold below one hundred percent',
      missing: 'Every notification threshold is at or above 100.',
      matters:
        'A notification that fires at the limit tells you the budget is gone rather than going. The whole value of the number is that it is lower than the one that hurts.',
      run: (b) =>
        budgetBlocks(b).some((x) =>
          findNested(x, 'notification').some((n) => {
            const threshold = numberAttr(n, 'threshold');
            return threshold !== null && threshold > 0 && threshold < 100;
          }),
        ),
    },
  ],
};

/**
 * Cost control on GCP, and the provider where the default outcome is closest
 * to nothing at all.
 *
 * A `google_billing_budget` with no `all_updates_rule` emails the billing
 * administrators on the account. That is a real notification, and it is
 * almost always the wrong people: on any team that has separated billing from
 * engineering, it reaches somebody who cannot see the resource, cannot tell a
 * legitimate spike from a runaway, and is not on call. The people who could
 * act on it are not told.
 *
 * `threshold_rules` is the other half and is genuinely inert without: a
 * budget with an amount and no rules never notifies anybody about anything.
 * It is valid, it deploys, and the number sits in the console being correct.
 *
 * Same forecast point as Azure, under GCP's name for it: `spend_basis`
 * defaults to CURRENT_SPEND, and FORECASTED_SPEND is what makes the warning
 * arrive early enough to matter.
 */
const GCP_BUDGET_TELLS_THE_RIGHT_PEOPLE: GradedTask = {
  id: 'task_budget_tells_the_right_people_gcp_v1',
  capabilities: ['cost_control'],
  track: 'aws_cloud',
  title: 'Make a budget tell the people who can actually act on it',
  timeboxMinutes: 30,
  brief: (p) => [
    'A project runs a data pipeline and nobody on the engineering team hears about its cost until finance asks.',
    `Name the budget ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Set a monthly amount.',
    'The engineers who can change the pipeline must be told, not only whoever owns the billing account.',
    'Being told once the money is spent is not useful. Somebody has to hear in time to act.',
    'Paste the Terraform below. Assume the billing account and a notification channel already exist.',
  ],
  identity: {
    requirement: 'The budget is named as the brief specifies',
    missing:
      'The display name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_billing_budget').some((x) =>
        (stringAttr(x, 'display_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'billing_budget_exists',
      requirement: 'A billing budget with an amount',
      missing: 'No google_billing_budget with an amount block was found.',
      matters:
        'A budget does not cap anything on any cloud. It is a notification, so the amount is only the point at which somebody is told.',
      run: (b) =>
        findResources(b, 'google_billing_budget').some((x) => findNested(x, 'amount').length > 0),
    },
    {
      id: 'has_threshold_rules',
      requirement: 'At least one threshold rule',
      missing: 'No threshold_rules block was found on the budget.',
      matters:
        'Without one the budget notifies nobody about anything. It is valid, it deploys, and the number sits in the console being correct while nothing watches it.',
      run: (b) =>
        findResources(b, 'google_billing_budget').some(
          (x) => findNested(x, 'threshold_rules').length > 0,
        ),
    },
    {
      id: 'notifies_beyond_billing_admins',
      requirement: 'An updates rule naming a channel or a topic',
      missing:
        'No all_updates_rule with monitoring_notification_channels or a pubsub_topic was found.',
      matters:
        'This is the check the task turns on. Left out, the budget emails the billing administrators, which on any team that has separated billing from engineering is somebody who cannot see the resource, cannot tell a spike from a runaway, and is not on call. The people who could act are not told, and nothing anywhere reports that as a gap.',
      run: (b) =>
        findResources(b, 'google_billing_budget').some((x) =>
          findNested(x, 'all_updates_rule').some(
            (r) =>
              attrText(r, 'monitoring_notification_channels').trim().length > 0 ||
              attrText(r, 'pubsub_topic').trim().length > 0,
          ),
        ),
    },
    {
      id: 'forecast_not_just_current',
      requirement: 'A rule on forecasted rather than current spend',
      missing:
        'No threshold_rules sets spend_basis = "FORECASTED_SPEND". The default is CURRENT_SPEND, which reports money already spent.',
      matters:
        "The same point Azure makes with threshold_type, under GCP's name for it. Current spend at ninety percent is a report on the past. Forecast is what the month will cost if nothing changes, and it is the version that leaves time to do something.",
      run: (b) =>
        findResources(b, 'google_billing_budget').some((x) =>
          findNested(x, 'threshold_rules').some(
            (r) => (stringAttr(r, 'spend_basis') ?? '').toUpperCase() === 'FORECASTED_SPEND',
          ),
        ),
    },
    {
      id: 'warns_below_the_amount',
      requirement: 'A threshold below the full amount',
      missing: 'Every threshold_percent is at or above 1.0.',
      matters:
        'A rule that fires at the full amount says the budget is gone rather than going. On GCP the percentage is a fraction, so the number to look for is below one rather than below a hundred.',
      run: (b) =>
        findResources(b, 'google_billing_budget').some((x) =>
          findNested(x, 'threshold_rules').some((r) => {
            const percent = numberAttr(r, 'threshold_percent');
            return percent !== null && percent > 0 && percent < 1;
          }),
        ),
    },
  ],
};

/**
 * Auditability on Azure, for the cloud_security track.
 *
 * An Azure resource logs almost nothing about itself by default. The activity
 * log records control-plane operations at the subscription and keeps them for
 * ninety days; everything about what happened *inside* a resource - who read
 * which blob, who opened which secret - exists only if a diagnostic setting
 * says where to send it.
 *
 * The mistake this grades is subtler than forgetting the setting. A
 * diagnostic setting with only a `metric` block is valid, deploys, appears in
 * the portal as configured, and gives you charts. It carries no log entries at
 * all. Somebody investigating an incident finds a graph of request counts and
 * no record of a single request, and finds it at the moment they most need the
 * opposite.
 */
const AZURE_AUDIT_TRAIL_EXISTS: GradedTask = {
  id: 'task_audit_trail_exists_azure_v1',
  capabilities: ['auditability'],
  track: 'cloud_security',
  title: 'Keep a record of who touched the secrets',
  timeboxMinutes: 35,
  brief: (p) => [
    'A Key Vault holds production credentials and nobody can currently say who has read them.',
    `Name the diagnostic setting ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    "Send the vault's audit records somewhere they are kept.",
    'Charts of request counts are not a record of who did what. Make sure the entries themselves are captured.',
    'They must outlive the default ninety days.',
    'Paste the Terraform below. Assume the Key Vault and a Log Analytics workspace already exist.',
  ],
  identity: {
    requirement: 'The diagnostic setting is named as the brief specifies',
    missing:
      'The diagnostic setting name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_monitor_diagnostic_setting').some((d) =>
        (stringAttr(d, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'diagnostic_setting',
      requirement: 'A diagnostic setting attached to a resource',
      missing: 'No azurerm_monitor_diagnostic_setting with a target_resource_id was found.',
      matters:
        'Nothing inside an Azure resource is recorded anywhere until a diagnostic setting says where to send it. This is the resource that turns the logging on.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_diagnostic_setting').some(
          (d) => attrText(d, 'target_resource_id').trim().length > 0,
        ),
    },
    {
      id: 'somewhere_to_send_it',
      requirement: 'A destination for the records',
      missing:
        'The setting names no log_analytics_workspace_id, storage_account_id or eventhub_authorization_rule_id.',
      matters:
        'A setting with no destination is accepted and delivers nowhere. The records are generated and dropped.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_diagnostic_setting').some(
          (d) =>
            attrText(d, 'log_analytics_workspace_id').trim().length > 0 ||
            attrText(d, 'storage_account_id').trim().length > 0 ||
            attrText(d, 'eventhub_authorization_rule_id').trim().length > 0,
        ),
    },
    {
      id: 'logs_not_only_metrics',
      requirement: 'A log category, not only metrics',
      missing:
        'The setting has no enabled_log or log block. A metric block alone captures counts and no entries.',
      matters:
        'This is the check the task turns on. A metrics-only diagnostic setting is valid, deploys, reads as configured in the portal, and produces charts. It contains no record of a single access. Somebody investigating who read a credential finds a graph of how many times it was read, which is the one thing that cannot answer the question.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_diagnostic_setting').some(
          (d) => findNested(d, 'enabled_log').length > 0 || findNested(d, 'log').length > 0,
        ),
    },
    {
      id: 'kept_longer_than_the_default',
      requirement: 'Retention beyond the ninety-day default',
      missing: 'No retention_in_days above 90 was found on the workspace or the setting.',
      matters:
        'The activity log keeps ninety days and cannot be extended in place. Most breaches are found later than that, so a record that expires on the default schedule is a record that is reliably gone by the time anybody looks.',
      run: (b) => {
        const candidates = [
          ...findResources(b, 'azurerm_log_analytics_workspace'),
          ...findResources(b, 'azurerm_monitor_diagnostic_setting'),
          ...findResources(b, 'azurerm_storage_management_policy'),
        ];
        return candidates.some((r) => {
          const value = attrAnywhere(r, 'retention_in_days');
          return value !== null && value.kind === 'number' && value.value > 90;
        });
      },
    },
    {
      id: 'not_reading_its_own_destination',
      requirement: 'The records do not go back into the vault being audited',
      missing:
        'The diagnostic setting targets the same Key Vault it sends to, so the audit trail lives inside the thing it is auditing.',
      matters:
        'Anybody who can tamper with the vault can tamper with its own record of being tampered with. An audit trail is only worth something if the person it would incriminate cannot reach it.',
      run: (b) =>
        findResources(b, 'azurerm_monitor_diagnostic_setting').every((d) => {
          const target = attrText(d, 'target_resource_id');
          const vault = /azurerm_key_vault\.(\w+)/.exec(target)?.[1];
          if (!vault) return true;
          const destinations = [
            attrText(d, 'log_analytics_workspace_id'),
            attrText(d, 'storage_account_id'),
            attrText(d, 'eventhub_authorization_rule_id'),
          ].join(' ');
          return !new RegExp(`azurerm_key_vault\\.${vault}\\b`).test(destinations);
        }),
    },
  ],
};

/**
 * Auditability on GCP, and the one with the most consequential default in the
 * whole set.
 *
 * Google splits audit logs in two. Admin Activity is always on, free, and
 * records changes: who created the bucket, who altered the policy. Data
 * Access records reads, and it is **off by default for every service except
 * BigQuery**, cannot be turned on retroactively, and is the half that answers
 * the only question that matters after a credential leaks: what did they
 * look at.
 *
 * So the failure here is not silence. Logging is on, the sink works, entries
 * arrive, and a reviewer sees a healthy audit pipeline. It records that
 * somebody's access was granted and never records them using it. The gap is
 * invisible until an incident, and by then the missing months cannot be
 * recovered, because the logs were never generated in the first place rather
 * than generated and deleted.
 */
const GCP_AUDIT_RECORDS_READS: GradedTask = {
  id: 'task_audit_records_reads_gcp_v1',
  capabilities: ['auditability'],
  track: 'cloud_security',
  title: 'Record what people read, not only what they changed',
  timeboxMinutes: 35,
  brief: (p) => [
    'A project holds customer data in Cloud Storage. After a credential leak nobody could say which objects had been read.',
    `Name the log sink ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Make sure reads are recorded, not only changes. On this provider that is a separate decision and it is not on by default.',
    'Send the records somewhere outside the project they describe.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The log sink is named as the brief specifies',
    missing:
      'The sink name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_logging_project_sink').some((s) =>
        (stringAttr(s, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'log_sink',
      requirement: 'A log sink with a destination',
      missing: 'No google_logging_project_sink with a destination was found.',
      matters:
        'Logs are retained for a limited window in the project by default. A sink is what puts them somewhere they can be kept and read later.',
      run: (b) =>
        findResources(b, 'google_logging_project_sink').some(
          (s) => attrText(s, 'destination').trim().length > 0,
        ),
    },
    {
      id: 'data_access_logging_enabled',
      requirement: 'Data Access audit logs are switched on',
      missing: 'No google_project_iam_audit_config with a DATA_READ audit_log_config was found.',
      matters:
        'This is the check the task turns on, and it is the most consequential default on any of the three providers. Admin Activity logging is always on and records changes. Data Access records reads, is off by default for every service except BigQuery, and cannot be enabled retroactively. Without it the pipeline looks healthy and answers every question except the one asked after a leak.',
      run: (b) =>
        findResources(b, 'google_project_iam_audit_config').some((c) =>
          findNested(c, 'audit_log_config').some((l) =>
            (stringAttr(l, 'log_type') ?? '').toUpperCase().startsWith('DATA_'),
          ),
        ),
    },
    {
      id: 'reads_specifically',
      requirement: 'DATA_READ, not only DATA_WRITE',
      missing: 'An audit_log_config was found but none of them names DATA_READ.',
      matters:
        'DATA_WRITE records modifications, which Admin Activity largely covers already. DATA_READ is the one that says who looked, and it is the half people leave out because it is also the noisier and more expensive half.',
      run: (b) =>
        findResources(b, 'google_project_iam_audit_config').some((c) =>
          findNested(c, 'audit_log_config').some(
            (l) => (stringAttr(l, 'log_type') ?? '').toUpperCase() === 'DATA_READ',
          ),
        ),
    },
    {
      id: 'covers_the_storage_service',
      requirement: 'The audit config covers storage rather than only one narrow service',
      missing: 'No audit config names storage.googleapis.com or allServices.',
      matters:
        'The service is named per config, so switching Data Access on for one API leaves every other one exactly as it was. The brief is about objects being read, so the config has to reach the storage API or all of them.',
      run: (b) =>
        findResources(b, 'google_project_iam_audit_config').some((c) => {
          const service = (stringAttr(c, 'service') ?? '').toLowerCase();
          return service === 'allservices' || service.includes('storage');
        }),
    },
    {
      id: 'records_leave_the_project',
      requirement: 'The destination is outside the project being audited',
      missing:
        'The sink destination points back into this project, so the records sit inside the thing they describe.',
      matters:
        'Somebody who can act in the project can usually also delete what recorded them acting. A sink into the same project is a record kept where the person it would incriminate can reach it.',
      run: (b) =>
        findResources(b, 'google_logging_project_sink').every((s) => {
          const destination = attrText(s, 'destination').toLowerCase();
          if (destination.trim() === '') return false;
          // A destination that names this project's own logging bucket is the
          // case being refused. Anything crossing into another project, or a
          // bucket resource declared for the purpose, is accepted.
          return !destination.includes('logging.googleapis.com/projects');
        }),
    },
  ],
};

/**
 * Safe release on Azure, for the devops_platform and mlops tracks.
 *
 * Container Apps splits traffic across revisions with an explicit weight
 * block, which makes this the rare case where the dangerous thing is written
 * down rather than defaulted into. `latest_revision = true` at a hundred
 * percent is the shape almost every example uses, and it means every deploy
 * moves all production traffic to code that has served no requests yet.
 *
 * It also reads as correct. Traffic weights are configured, the block is
 * present, somebody clearly thought about it. The number is just the number
 * that removes the entire point of having the block.
 *
 * The revision mode is graded with it because the two only work as a pair. In
 * Single mode a new revision replaces the old one and there is nothing to
 * split traffic between, so a weight block sits in the configuration doing
 * nothing at all.
 */
const AZURE_CANARY_BEFORE_EVERYONE: GradedTask = {
  id: 'task_canary_before_everyone_azure_v1',
  capabilities: ['safe_release'],
  track: 'devops_platform',
  title: 'Send a new version to a few people before everybody',
  timeboxMinutes: 35,
  brief: (p) => [
    'A Container App serves the main API. Every deploy currently goes straight to all traffic and two outages started that way.',
    `Name the container app ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'A new version must take a small share of traffic first, not all of it.',
    'The previous version has to still be there to send traffic back to.',
    'Pin the image to something that cannot change under you.',
    'Paste the Terraform below. Assume the environment and registry already exist.',
  ],
  identity: {
    requirement: 'The container app is named as the brief specifies',
    missing:
      'The container app name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_container_app').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'container_app',
      requirement: 'A container app with a template',
      missing: 'No azurerm_container_app with a template block was found.',
      matters:
        'The template is what a revision is made of, and revisions are what traffic splits between.',
      run: (b) =>
        findResources(b, 'azurerm_container_app').some((a) => findNested(a, 'template').length > 0),
    },
    {
      id: 'multiple_revisions_allowed',
      requirement: 'Revision mode allows more than one revision at a time',
      missing: 'revision_mode is absent or set to Single.',
      matters:
        'In Single mode a new revision replaces the old one and there is nothing left to split traffic with or roll back to. A weight block underneath it is configuration that cannot do anything.',
      run: (b) =>
        findResources(b, 'azurerm_container_app').some(
          (a) => (stringAttr(a, 'revision_mode') ?? '').toLowerCase() === 'multiple',
        ),
    },
    {
      id: 'traffic_is_split',
      requirement: 'A traffic weight block',
      missing: 'No ingress with a traffic_weight block was found.',
      matters:
        'Without it the app has no statement about who gets what, and the platform sends everything to the newest revision.',
      run: (b) =>
        findResources(b, 'azurerm_container_app').some(
          (a) => findNested(a, 'traffic_weight').length > 0,
        ),
    },
    {
      id: 'new_version_is_not_everybody',
      requirement: 'The new revision takes less than all the traffic',
      missing:
        'A traffic_weight sends 100 percent to the latest revision, so a deploy still moves everyone at once.',
      matters:
        'This is the check the task turns on, and it is the version of the mistake that looks most like care. Traffic weights are present and deliberate. The weight is simply a hundred, which is the same behaviour as having no split at all, arrived at through a block that says one was considered.',
      run: (b) =>
        findResources(b, 'azurerm_container_app').some((a) => {
          const weights = findNested(a, 'traffic_weight');
          if (weights.length === 0) return false;
          const latest = weights.filter((w) => boolAttr(w, 'latest_revision') === true);
          if (latest.length === 0) return weights.length > 1;
          return latest.every((w) => {
            const percentage = numberAttr(w, 'percentage');
            return percentage !== null && percentage < 100;
          });
        }),
    },
    {
      id: 'image_cannot_change_underneath',
      requirement: 'The image is pinned rather than floating',
      missing: 'A container image uses no tag, or the tag is latest.',
      matters:
        'A canary proves a specific build is safe. If the tag can move, the thing promoted after the canary passes is not necessarily the thing the canary tested, and the rollback target is not necessarily the code that was working.',
      run: (b) => {
        const images = findResources(b, 'azurerm_container_app')
          .flatMap((a) => findNested(a, 'container'))
          .map((c) => stringAttr(c, 'image') ?? '')
          .filter((image) => image.trim().length > 0);
        return images.length > 0 && images.every(isPinnedImage);
      },
    },
  ],
};

/**
 * Safe release on GCP, and the closest parallel of the whole set, because
 * Cloud Run states the same decision with the same shape and the same wrong
 * default.
 *
 * `traffic { latest_revision = true, percent = 100 }` is what the console
 * produces, what most examples show, and what makes every deploy an
 * all-at-once cutover. Written out in Terraform it looks like a considered
 * traffic policy, which is exactly why it survives review.
 *
 * The difference from Azure is what a rollback costs. Cloud Run keeps every
 * revision addressable by name forever, so pinning traffic to a named
 * revision beside the canary is one line and makes going back instant. Not
 * naming one leaves the previous version reachable in principle and not
 * referenced anywhere, which is where the minutes go during an incident.
 */
const GCP_CANARY_BEFORE_EVERYONE: GradedTask = {
  id: 'task_canary_before_everyone_gcp_v1',
  capabilities: ['safe_release'],
  track: 'devops_platform',
  title: 'Roll a new revision out to a slice of traffic',
  timeboxMinutes: 35,
  brief: (p) => [
    'A Cloud Run service takes production traffic and every deploy currently switches all of it at once.',
    `Name the service ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'A new revision must take a small share first.',
    'Name the revision the rest of the traffic stays on, so going back is one change and not an investigation.',
    'Pin the image to something that cannot change under you.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The service is named as the brief specifies',
    missing:
      'The service name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_cloud_run_v2_service').some((s) =>
        (stringAttr(s, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'cloud_run_service',
      requirement: 'A Cloud Run service with a template',
      missing: 'No google_cloud_run_v2_service with a template block was found.',
      matters:
        'The template defines the revision, and revisions are what traffic is split between.',
      run: (b) =>
        findResources(b, 'google_cloud_run_v2_service').some(
          (s) => findNested(s, 'template').length > 0,
        ),
    },
    {
      id: 'traffic_block',
      requirement: 'An explicit traffic block',
      missing: 'No traffic block was found on the service.',
      matters:
        'Without one, Cloud Run routes everything to the newest revision the moment it is ready. The block is the only place a different intention can be stated.',
      run: (b) =>
        findResources(b, 'google_cloud_run_v2_service').some(
          (s) => findNested(s, 'traffic').length > 0,
        ),
    },
    {
      id: 'latest_is_not_everything',
      requirement: 'The newest revision does not take all the traffic',
      missing:
        'A traffic block sends 100 percent to the latest revision, which is the same as having no split.',
      matters:
        'This is the check the task turns on. It is the default the console writes and the shape most examples show, and written out in Terraform it reads as a considered traffic policy rather than as the absence of one.',
      run: (b) =>
        findResources(b, 'google_cloud_run_v2_service').some((s) => {
          const blocks = findNested(s, 'traffic');
          if (blocks.length === 0) return false;
          const latest = blocks.filter((t) =>
            (stringAttr(t, 'type') ?? '').toUpperCase().includes('LATEST'),
          );
          if (latest.length === 0) return blocks.length > 1;
          return latest.every((t) => {
            const percent = numberAttr(t, 'percent');
            return percent !== null && percent < 100;
          });
        }),
    },
    {
      id: 'rollback_target_is_named',
      requirement: 'A named revision holds the remaining traffic',
      missing:
        'No traffic block names a revision, so the version to go back to is not written down anywhere.',
      matters:
        'Cloud Run keeps every revision addressable by name for as long as the service exists, so naming one costs a line and makes a rollback a single edit. Leaving it unnamed means that during an incident somebody has to work out what was running before, which is the worst time to be finding out.',
      run: (b) =>
        findResources(b, 'google_cloud_run_v2_service').some((s) =>
          findNested(s, 'traffic').some((t) => attrText(t, 'revision').trim().length > 0),
        ),
    },
    {
      id: 'image_is_pinned',
      requirement: 'The image is pinned rather than floating',
      missing: 'A container image uses no tag, or the tag is latest.',
      matters:
        'A canary proves one specific build is safe. A moving tag means the build promoted afterwards is not necessarily the one that was tested, and neither is the one rolled back to.',
      run: (b) => {
        const images = findResources(b, 'google_cloud_run_v2_service')
          .flatMap((s) => findNested(s, 'containers'))
          .map((c) => stringAttr(c, 'image') ?? '')
          .filter((image) => image.trim().length > 0);
        return images.length > 0 && images.every(isPinnedImage);
      },
    },
  ],
};

/**
 * Data protection on Azure, and a task about the way customer-managed keys
 * go wrong, which is almost never the encryption.
 *
 * Bringing your own key moves the risk rather than removing it. The data is
 * now exactly as durable as the key, and Azure will let you delete the key
 * while the data still needs it. Soft delete gives a window to undo that;
 * purge protection is what stops somebody emptying the bin during the window.
 * Without it, one purge makes every byte encrypted under that key permanently
 * unreadable, with no recovery path at any support tier.
 *
 * Azure itself requires purge protection before a vault can be used for
 * storage encryption, which is the strongest signal available that this is
 * the failure worth grading: the platform refuses the configuration outright
 * rather than warning about it.
 */
const AZURE_KEY_YOU_CANNOT_LOSE: GradedTask = {
  id: 'task_key_you_cannot_lose_azure_v1',
  capabilities: ['data_protection'],
  track: 'cloud_security',
  title: 'Encrypt with your own key without making the data unrecoverable',
  timeboxMinutes: 40,
  brief: (p) => [
    'A storage account holds customer records and compliance requires encryption under a key the company controls.',
    `Name the key vault so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Encrypt the account with a key from that vault.',
    'Deleting the key must not be able to destroy the data. Make sure a deletion can be undone, and that nobody can force it through.',
    'Traffic to the account must be encrypted with a current protocol.',
    'Paste the Terraform below. Assume the resource group exists.',
  ],
  identity: {
    requirement: 'The key vault is named as the brief specifies',
    missing:
      'The key vault name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_key_vault').some((v) =>
        (stringAttr(v, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'vault_and_key',
      requirement: 'A key vault and a key in it',
      missing: 'No azurerm_key_vault, or no azurerm_key_vault_key, was found.',
      matters:
        'The key is the thing being controlled, and the vault is what controls access to it.',
      run: (b) =>
        findResources(b, 'azurerm_key_vault').length > 0 &&
        findResources(b, 'azurerm_key_vault_key').length > 0,
    },
    {
      id: 'deletion_can_be_undone',
      requirement: 'Soft delete retention on the vault',
      missing: 'No soft_delete_retention_days was set.',
      matters:
        'It is the window in which a deleted key can be brought back. Without it a deletion is immediate, and the data encrypted under that key becomes unreadable the moment somebody makes a mistake.',
      run: (b) =>
        findResources(b, 'azurerm_key_vault').some((v) => {
          const days = numberAttr(v, 'soft_delete_retention_days');
          return days !== null && days > 0;
        }),
    },
    {
      id: 'nobody_can_force_the_delete',
      requirement: 'Purge protection is enabled',
      missing: 'purge_protection_enabled is absent or false.',
      matters:
        'This is the check the task turns on. Soft delete gives a window; purge protection is what stops somebody emptying the bin inside it. Without it one purge makes every byte under that key permanently unreadable, with no recovery at any support tier. Azure refuses to let a vault without it be used for storage encryption at all, which says how it rates the risk.',
      run: (b) =>
        findResources(b, 'azurerm_key_vault').some(
          (v) => boolAttr(v, 'purge_protection_enabled') === true,
        ),
    },
    {
      id: 'account_uses_the_key',
      requirement: 'The storage account is encrypted with that key',
      missing:
        'No customer_managed_key block, and no azurerm_storage_account_customer_managed_key resource, was found.',
      matters:
        'A vault and a key beside an account that still uses Microsoft-managed encryption is the whole exercise done and not connected. Nothing errors, and the compliance requirement is unmet.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account_customer_managed_key').length > 0 ||
        findResources(b, 'azurerm_storage_account').some(
          (a) => findNested(a, 'customer_managed_key').length > 0,
        ),
    },
    {
      id: 'current_transport_security',
      requirement: 'TLS 1.2 or better, and no plain HTTP',
      missing: 'min_tls_version is below TLS1_2, or https_traffic_only_enabled is false.',
      matters:
        'Encryption at rest decides who can read the disk. This decides who can read the connection, and the older protocols excluded here have published attacks against them.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) => {
          const tls = (stringAttr(a, 'min_tls_version') ?? 'TLS1_2').toUpperCase();
          const modern = tls === 'TLS1_2' || tls === 'TLS1_3';
          const httpsOnly =
            boolAttr(a, 'https_traffic_only_enabled') !== false &&
            boolAttr(a, 'enable_https_traffic_only') !== false;
          return modern && httpsOnly;
        }),
    },
  ],
};

/**
 * Data protection on GCP, where the same key risk arrives through Terraform
 * rather than through the console.
 *
 * Google will not let you delete a key outright: a key version is scheduled
 * for destruction and waits out a period first, which is soft delete by
 * another name and is on by default. So the Azure failure is largely closed
 * here, and the interesting one moves.
 *
 * It moves into the configuration. `google_kms_crypto_key` documents in its
 * own provider docs that removing the resource from Terraform does not delete
 * the key, and that is exactly what lulls people: a `terraform destroy` on the
 * environment leaves the key and takes the bucket, or a refactor removes the
 * key resource and the state entry with the data still encrypted under it.
 * `prevent_destroy` is the line that stops the plan rather than the API.
 *
 * The other half is rotation, which has no equivalent default at all. A key
 * with no `rotation_period` never rotates, and a key that never rotates is a
 * key whose entire history is readable by anybody who obtains it once.
 */
const GCP_KEY_YOU_CONTROL: GradedTask = {
  id: 'task_key_you_control_gcp_v1',
  capabilities: ['data_protection'],
  track: 'cloud_security',
  title: 'Encrypt with a key you control and actually rotate',
  timeboxMinutes: 40,
  brief: (p) => [
    'A bucket holds customer records and compliance requires encryption under a key the company controls.',
    `Name the crypto key so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Encrypt the bucket with that key.',
    'The key must rotate on a schedule.',
    'Removing this configuration must not be able to take the key with it.',
    'Object permissions must not be settable per object.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The crypto key is named as the brief specifies',
    missing:
      'The crypto key name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_kms_crypto_key').some((k) =>
        (stringAttr(k, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'key_ring_and_key',
      requirement: 'A key ring and a crypto key',
      missing: 'No google_kms_key_ring, or no google_kms_crypto_key, was found.',
      matters: 'The key is the thing being controlled; the ring is where it lives and is scoped.',
      run: (b) =>
        findResources(b, 'google_kms_key_ring').length > 0 &&
        findResources(b, 'google_kms_crypto_key').length > 0,
    },
    {
      id: 'key_rotates',
      requirement: 'A rotation period on the key',
      missing: 'No rotation_period was set on the crypto key.',
      matters:
        'There is no default. A key with no rotation period never rotates, so anybody who obtains it once can read everything ever written under it, including everything written afterwards. Rotation is what bounds a single compromise to a window.',
      run: (b) =>
        findResources(b, 'google_kms_crypto_key').some(
          (k) => attrText(k, 'rotation_period').trim().length > 0,
        ),
    },
    {
      id: 'bucket_uses_the_key',
      requirement: 'The bucket is encrypted with that key',
      missing: 'No encryption block with a default_kms_key_name was found on the bucket.',
      matters:
        'A key beside a bucket that still uses Google-managed encryption is the work done and not connected. Nothing errors and the requirement is unmet.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'encryption').some(
            (e) => attrText(e, 'default_kms_key_name').trim().length > 0,
          ),
        ),
    },
    {
      id: 'config_cannot_take_the_key_with_it',
      requirement: 'The key is protected from destruction by the plan',
      missing: 'No lifecycle block with prevent_destroy = true was found on the crypto key.',
      matters:
        'This is the check the task turns on, and it is a Terraform failure rather than a cloud one. Google will not delete a key immediately, so the API side is largely safe. The plan is not: a destroy on the environment, or a refactor that drops the resource, is where a key and the data under it part company. prevent_destroy stops the plan rather than the API.',
      run: (b) =>
        findResources(b, 'google_kms_crypto_key').some((k) =>
          findNested(k, 'lifecycle').some((l) => boolAttr(l, 'prevent_destroy') === true),
        ),
    },
    {
      id: 'no_per_object_permissions',
      requirement: 'Uniform bucket-level access',
      missing: 'uniform_bucket_level_access is absent or false.',
      matters:
        'With legacy ACLs available, a single object can be made readable by anyone regardless of how carefully the bucket policy and the encryption were set up. Encryption does not help when the permission check says yes.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some(
          (r) => boolAttr(r, 'uniform_bucket_level_access') === true,
        ),
    },
  ],
};

/**
 * Supply chain integrity on Azure, for the devops_platform track.
 *
 * The AWS task for this capability is about the image: scanned, immutably
 * tagged, pinned. This is about the registry the image lives in, because on
 * Azure that is where the reachable mistake is.
 *
 * `admin_enabled` is the one to grade. It creates a single username and
 * password with push rights over the whole registry, it is one line, it makes
 * every authentication problem disappear, and every example that needs a
 * working `docker login` in two minutes reaches for it. Once it is on, one
 * shared credential can replace the contents of any tag in the registry, and
 * nothing downstream that pulls by tag would notice.
 *
 * Anonymous pull is the other direction of the same question. It is a
 * legitimate feature for public images and a serious one for a registry
 * holding anything internal, because it makes the registry readable by
 * anybody who guesses the name.
 */
const AZURE_REGISTRY_NOT_A_BACK_DOOR: GradedTask = {
  id: 'task_registry_not_a_back_door_azure_v1',
  capabilities: ['supply_chain_integrity'],
  track: 'devops_platform',
  title: 'Run a registry that cannot be quietly rewritten',
  timeboxMinutes: 35,
  brief: (p) => [
    'A container registry holds every image the company deploys. Anybody who can change what a tag points at can change what runs in production.',
    `Name the registry so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Nobody should be authenticating with a shared registry credential.',
    'The registry must not be readable without authenticating.',
    'A tag that has been published must not be repointable at different content.',
    'Deployments must pull images by a reference that cannot be moved.',
    'Paste the Terraform below. Assume the resource group exists.',
  ],
  identity: {
    requirement: 'The registry is named as the brief specifies',
    missing:
      'The registry name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_container_registry').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'registry_exists',
      requirement: 'A container registry',
      missing: 'No azurerm_container_registry resource was found.',
      matters: 'Everything else here is a property of it.',
      run: (b) => findResources(b, 'azurerm_container_registry').length > 0,
    },
    {
      id: 'no_shared_admin_credential',
      requirement: 'The admin account is disabled',
      missing: 'admin_enabled is set to true on the registry.',
      matters:
        'This is the check the task turns on. The admin account is a single username and password with push rights over the entire registry, shared by everybody who has it and attributable to nobody. It is one line, it makes every authentication problem go away, and it means one leaked credential can replace the content behind any tag without anything downstream noticing.',
      run: (b) =>
        findResources(b, 'azurerm_container_registry').every(
          (r) => boolAttr(r, 'admin_enabled') !== true,
        ),
    },
    {
      id: 'not_readable_by_anyone',
      requirement: 'Anonymous pull is off',
      missing: 'anonymous_pull_enabled is set to true.',
      matters:
        'A legitimate feature for publishing public images, and a serious problem for a registry holding internal ones, because it makes every image readable by anybody who can guess the registry name. Images routinely contain configuration, dependency lists and occasionally credentials.',
      run: (b) =>
        findResources(b, 'azurerm_container_registry').every(
          (r) => boolAttr(r, 'anonymous_pull_enabled') !== true,
        ),
    },
    {
      id: 'published_tags_cannot_move',
      requirement: 'Images are retained rather than freely overwritten',
      missing:
        'No retention_policy or quarantine_policy was found, and no lock prevents the registry being changed.',
      matters:
        'A tag that can be repointed means the artifact that passed review and the artifact that ships are two different things that share a name. Every check upstream of that is evidence about something else.',
      run: (b) =>
        findResources(b, 'azurerm_container_registry').some(
          (r) =>
            findNested(r, 'retention_policy').length > 0 ||
            findNested(r, 'quarantine_policy').length > 0 ||
            boolAttr(r, 'quarantine_policy_enabled') === true ||
            numberAttr(r, 'retention_policy_in_days') !== null,
        ) || findResources(b, 'azurerm_management_lock').length > 0,
    },
    {
      id: 'deployments_pin_the_image',
      requirement: 'Anything deployed here references a pinned image',
      missing: 'A deployed container image uses no tag, or the tag is latest.',
      matters:
        'A registry that cannot be rewritten protects the artifact. Pulling by a moving reference gives that protection away at the last step, because the thing that was reviewed and the thing that starts are decided at different moments.',
      run: (b) => {
        const images = [
          ...findResources(b, 'azurerm_container_app').flatMap((a) => findNested(a, 'container')),
          ...findResources(b, 'azurerm_container_group').flatMap((g) => findNested(g, 'container')),
        ]
          .map((c) => stringAttr(c, 'image') ?? '')
          .filter((image) => image.trim().length > 0);
        // No deployment in the submission is not a failure: the brief allows
        // answering with the registry alone.
        return images.every(isPinnedImage);
      },
    },
  ],
};

/**
 * Supply chain integrity on GCP, and the only task in the set where the
 * platform offers a real answer to "prove this image is the one we built".
 *
 * Binary Authorization is an admission gate: it refuses to run an image
 * unless something it trusts has signed for it. That makes it the strongest
 * version of this capability available on any of the three providers, and it
 * also makes its default the sharpest trap, because a policy resource can
 * exist, be attached, be referenced, and evaluate to `ALWAYS_ALLOW`.
 *
 * A policy set to allow everything is not a weaker control. It is the absence
 * of the control with a resource in the plan, a name in the console, and a
 * line in a compliance document saying Binary Authorization is enabled. That
 * is worse than not having it, because the claim outlives the check.
 */
const GCP_ONLY_SIGNED_IMAGES_RUN: GradedTask = {
  id: 'task_only_signed_images_run_gcp_v1',
  capabilities: ['supply_chain_integrity'],
  track: 'devops_platform',
  title: 'Refuse to run an image nobody signed for',
  timeboxMinutes: 40,
  brief: (p) => [
    'Anything can currently be deployed to the production project as long as it is in the registry.',
    `Name the attestor so it contains ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Only images somebody has signed for may run.',
    'The default for anything not covered must be refusal, not permission.',
    "Google's own system images have to keep working.",
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The attestor is named as the brief specifies',
    missing:
      'The attestor name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_binary_authorization_attestor').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'attestor_exists',
      requirement: 'An attestor',
      missing: 'No google_binary_authorization_attestor resource was found.',
      matters:
        'The attestor is the identity whose signature counts. Without one there is nobody whose word the gate is checking.',
      run: (b) => findResources(b, 'google_binary_authorization_attestor').length > 0,
    },
    {
      id: 'policy_exists',
      requirement: 'A Binary Authorization policy',
      missing: 'No google_binary_authorization_policy resource was found.',
      matters: 'The policy is the gate. An attestor without one signs for nothing.',
      run: (b) => findResources(b, 'google_binary_authorization_policy').length > 0,
    },
    {
      id: 'default_is_refusal',
      requirement: 'The default admission rule requires an attestation',
      missing:
        'default_admission_rule has evaluation_mode ALWAYS_ALLOW, or no default_admission_rule was found.',
      matters:
        'This is the check the task turns on, and the failure is worse than having no policy. ALWAYS_ALLOW is a resource in the plan, a name in the console, and a line in a compliance document claiming Binary Authorization is enabled, gating nothing. The claim outlives the check, which is how it survives an audit that a missing policy would not.',
      run: (b) =>
        findResources(b, 'google_binary_authorization_policy').some((p) =>
          findNested(p, 'default_admission_rule').some((r) => {
            const mode = (stringAttr(r, 'evaluation_mode') ?? '').toUpperCase();
            return mode === 'REQUIRE_ATTESTATION';
          }),
        ),
    },
    {
      id: 'rule_names_the_attestor',
      requirement: 'The default rule names an attestor',
      missing: 'The default_admission_rule lists no require_attestations_by.',
      matters:
        'REQUIRE_ATTESTATION with an empty list is a rule that can never be satisfied by anybody. It fails closed, which is the safe direction, and it means nothing deploys at all until somebody notices and usually relaxes the mode rather than fixing the list.',
      run: (b) =>
        findResources(b, 'google_binary_authorization_policy').some((p) =>
          findNested(p, 'default_admission_rule').some(
            (r) => attrText(r, 'require_attestations_by').trim().length > 0,
          ),
        ),
    },
    {
      id: 'system_images_still_allowed',
      requirement: 'An exemption for Google system images',
      missing: 'No admission_whitelist_patterns naming a Google-operated registry was found.',
      matters:
        "Cluster components come from Google-operated registries and nobody in your organisation can attest to them. Without an exemption the gate blocks the platform's own workloads, and the usual fix under that pressure is to weaken the default rule, which removes the control entirely.",
      run: (b) =>
        findResources(b, 'google_binary_authorization_policy').some((p) =>
          findNested(p, 'admission_whitelist_patterns').some((w) =>
            /gke\.gcr\.io|gcr\.io\/google|k8s\.gcr\.io|registry\.k8s\.io|pkg\.dev/i.test(
              attrText(w, 'name_pattern'),
            ),
          ),
        ),
    },
  ],
};

/**
 * A reproducible data path on Azure, for the MLOps track and the last
 * capability ADR 0004's step one needed.
 *
 * "Reproducible" is asked of the whole path rather than of the code, so this
 * grades a job by four things that have to hold together: the code cannot
 * move, the input cannot change, the output cannot land on top of the last
 * one, and the previous outputs are still there to compare against.
 *
 * The digest matters more here than anywhere else in the set, which is why
 * this is the one task that insists on it rather than accepting a version
 * tag. A tag is a promise from whoever pushed it; a digest is arithmetic. For
 * a safe rollout a version tag is a reasonable answer, because the question
 * is whether a specific build is healthy. For a result somebody may need to
 * defend in a year, "we ran 1.4.2" is only as good as nobody having moved
 * 1.4.2 since, and that is not something a rerun can establish.
 */
const AZURE_RERUNNABLE_JOB: GradedTask = {
  id: 'task_rerunnable_job_azure_v1',
  capabilities: ['reproducible_data_path'],
  track: 'mlops',
  title: 'Build a training run somebody can repeat in a year',
  timeboxMinutes: 40,
  brief: (p) => [
    'A nightly job reads a dataset, trains a model, and writes the result. Nobody can reproduce a result from three months ago.',
    `Name the job ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'The code that runs must be identified by something that cannot be repointed at different content. A version number is not enough here.',
    'The input data must keep its history, so the exact bytes a past run read are still available.',
    'The output must not be written into the same place as the input.',
    'A rerun must not destroy what the previous run produced.',
    'Paste the Terraform below. Assume the resource group and environment exist.',
  ],
  identity: {
    requirement: 'The job is named as the brief specifies',
    missing:
      'The job name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'azurerm_container_app_job').some((j) =>
        (stringAttr(j, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'job_exists',
      requirement: 'A container app job with a template',
      missing: 'No azurerm_container_app_job with a template block was found.',
      matters:
        'The job is the run being made reproducible; everything else describes its inputs and outputs.',
      run: (b) =>
        findResources(b, 'azurerm_container_app_job').some(
          (j) => findNested(j, 'template').length > 0,
        ),
    },
    {
      id: 'code_pinned_by_digest',
      requirement: 'The image is referenced by digest, not by tag',
      missing: 'A job image has no @sha256: digest.',
      matters:
        'The one task in this set that will not accept a version tag, because the question is different. A rollout asks whether a specific build is healthy, and a tag answers that. A result somebody has to defend in a year asks what actually ran, and "we ran 1.4.2" is only as good as nobody having moved 1.4.2 since. A digest is arithmetic rather than a promise.',
      run: (b) => {
        const images = findResources(b, 'azurerm_container_app_job')
          .flatMap((j) => findNested(j, 'container'))
          .map((c) => stringAttr(c, 'image') ?? '')
          .filter((image) => image.trim().length > 0);
        return images.length > 0 && images.every((image) => image.includes('@sha256:'));
      },
    },
    {
      id: 'input_keeps_its_history',
      requirement: 'Versioning on the account holding the data',
      missing: 'versioning_enabled was not set to true in blob_properties.',
      matters:
        'Without it, the dataset a past run read no longer exists the moment somebody overwrites it, and the run cannot be repeated even with the exact code. The output stops being evidence of anything, because the input it depended on is gone.',
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'blob_properties').some((p) => boolAttr(p, 'versioning_enabled') === true),
        ),
    },
    {
      id: 'output_is_somewhere_else',
      requirement: 'At least two containers, so output does not land on input',
      missing: 'Fewer than two azurerm_storage_container resources were found.',
      matters:
        'A job writing results back into the container it read from changes its own inputs. The second run reads something the first run produced, and the two are no longer the same experiment even though nothing failed.',
      run: (b) => findResources(b, 'azurerm_storage_container').length >= 2,
    },
    {
      id: 'previous_results_survive_a_rerun',
      requirement: 'Deleted or overwritten results are retained',
      missing: 'No delete_retention_policy was found in blob_properties.',
      matters:
        "Versioning keeps the input honest. This keeps the outputs comparable: a rerun that overwrites last month's result removes the only thing a new number could be checked against, and the removal is silent because overwriting is the normal way a job writes.",
      run: (b) =>
        findResources(b, 'azurerm_storage_account').some((a) =>
          findNested(a, 'blob_properties').some((p) =>
            findNested(p, 'delete_retention_policy').some((d) => {
              const days = numberAttr(d, 'days');
              return days !== null && days > 0;
            }),
          ),
        ),
    },
  ],
};

/**
 * A reproducible data path on GCP, and the pair that completes step one.
 *
 * Same four properties as the Azure task, and one genuinely different lever.
 * A GCP bucket can carry a retention policy that applies to objects rather
 * than to deletion behaviour, so the output location can be made
 * append-mostly at the storage layer: a rerun physically cannot replace last
 * month's result until the period is up, whoever runs it and whatever the job
 * intends.
 *
 * That is a stronger guarantee than any amount of care in the job itself, and
 * it is the reason the two rubrics differ. On Azure the previous result
 * survives because deletions are retained. Here it survives because the write
 * is refused.
 */
const GCP_RERUNNABLE_JOB: GradedTask = {
  id: 'task_rerunnable_job_gcp_v1',
  capabilities: ['reproducible_data_path'],
  track: 'mlops',
  title: 'Build a training run whose inputs cannot move',
  timeboxMinutes: 40,
  brief: (p) => [
    'A scheduled job reads a dataset, trains a model, and writes the result. Nobody can reproduce a result from three months ago.',
    `Name the job ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'The code that runs must be identified by something that cannot be repointed at different content. A version number is not enough here.',
    'The input data must keep its history.',
    'The output must go somewhere separate from the input.',
    'The storage itself must refuse to let a rerun replace an earlier result. Do not rely on the job being careful.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The job is named as the brief specifies',
    missing:
      'The job name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'google_cloud_run_v2_job').some((j) =>
        (stringAttr(j, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'cloud_run_job',
      requirement: 'A Cloud Run job with a template',
      missing: 'No google_cloud_run_v2_job with a template block was found.',
      matters: 'The job is the run being made reproducible.',
      run: (b) =>
        findResources(b, 'google_cloud_run_v2_job').some(
          (j) => findNested(j, 'template').length > 0,
        ),
    },
    {
      id: 'job_code_pinned_by_digest',
      requirement: 'The image is referenced by digest, not by tag',
      missing: 'A job image has no @sha256: digest.',
      matters:
        'A tag is a promise from whoever pushed it and a digest is arithmetic. For a result that has to be defensible later, "we ran 1.4.2" is only as good as nobody having moved 1.4.2 since, and a rerun cannot establish that.',
      run: (b) => {
        const images = findResources(b, 'google_cloud_run_v2_job')
          .flatMap((j) => findNested(j, 'containers'))
          .map((c) => stringAttr(c, 'image') ?? '')
          .filter((image) => image.trim().length > 0);
        return images.length > 0 && images.every((image) => image.includes('@sha256:'));
      },
    },
    {
      id: 'input_bucket_versioned',
      requirement: 'Versioning on the input bucket',
      missing: 'No bucket has a versioning block with enabled = true.',
      matters:
        'Without it, the dataset a past run read stops existing the moment somebody overwrites it, and the result stops being evidence of anything because its input is gone.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'versioning').some((v) => boolAttr(v, 'enabled') === true),
        ),
    },
    {
      id: 'separate_output_bucket',
      requirement: 'At least two buckets, so output does not land on input',
      missing: 'Fewer than two google_storage_bucket resources were found.',
      matters:
        'A job writing results into the bucket it reads from changes its own inputs. The next run trains on something the last run produced, and nothing fails to make that visible.',
      run: (b) => findResources(b, 'google_storage_bucket').length >= 2,
    },
    {
      id: 'storage_refuses_to_overwrite_results',
      requirement: 'A retention policy on a bucket, not just careful writing',
      missing: 'No retention_policy with a retention_period was found on any bucket.',
      matters:
        'This is the check the task turns on, and the lever Azure does not have in this shape. A retention policy makes the storage layer refuse to replace an object until its period is up, whoever runs the job and whatever the job intends. Relying on the job to write to a new path instead is a convention, and conventions are exactly what a rerun at 3am under pressure does not follow.',
      run: (b) =>
        findResources(b, 'google_storage_bucket').some((r) =>
          findNested(r, 'retention_policy').some((p) => {
            const period = numberAttr(p, 'retention_period');
            return period !== null && period > 0;
          }),
        ),
    },
  ],
};

const PLATFORM_HYGIENE: GradedTask = {
  id: 'task_platform_hygiene_v1',
  capabilities: ['observability_and_alerting', 'safe_release'],
  track: 'devops_platform',
  title: 'Ship a function that will not surprise you at 3am',
  timeboxMinutes: 35,
  brief: (p) => [
    'Write Terraform for one Lambda function and everything it needs to be operable.',
    `Name the function ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    `Your log retention is ${p.retentionDays} days. Use exactly that.`,
    'A runaway loop must not be able to consume the whole account.',
    'A reader should be able to tell what it costs to run at worst.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The function is named, and the retention set, as the brief specifies',
    missing:
      'The function name or the log retention in this submission is not what your brief asked for. Use the values in your own brief.',
    run: (b, p) => {
      const named = findResources(b, 'aws_lambda_function').some((f) =>
        (stringAttr(f, 'function_name') ?? '').includes(p.token),
      );
      const retention = findResources(b, 'aws_cloudwatch_log_group').some((g) => {
        const v = g.attributes['retention_in_days'];
        return v?.kind === 'number' && v.value === p.retentionDays;
      });
      return named && retention;
    },
  },
  passMark: 0,
  checks: [
    {
      id: 'function',
      requirement: 'A Lambda function',
      missing: 'No aws_lambda_function resource was found.',
      matters: 'Everything else attaches to it.',
      run: (b) => findResources(b, 'aws_lambda_function').length > 0,
    },
    {
      id: 'log_group',
      requirement: 'An explicit log group',
      missing: 'No aws_cloudwatch_log_group resource was found.',
      matters:
        'Lambda creates one implicitly with no expiry, so logs accumulate for ever and nobody notices until the bill does.',
      run: (b) => findResources(b, 'aws_cloudwatch_log_group').length > 0,
    },
    {
      id: 'retention',
      requirement: 'A retention period on that log group',
      missing: 'The log group has no retention_in_days.',
      matters: 'A log group without retention is the default that costs money quietly.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_log_group').some(
          (g) => g.attributes['retention_in_days'] !== undefined,
        ),
    },
    {
      id: 'concurrency',
      requirement: 'A bound on concurrency',
      missing: 'The function has no reserved_concurrent_executions.',
      matters:
        'Unbounded concurrency is how one bad deploy takes out every other function in the account.',
      run: (b) =>
        findResources(b, 'aws_lambda_function').some(
          (f) => f.attributes['reserved_concurrent_executions'] !== undefined,
        ),
    },
    {
      id: 'timeout',
      requirement: 'An explicit timeout',
      missing: 'The function has no timeout.',
      matters:
        'The default is three seconds, which is either wrong for the work or accidental. Either way it should be a decision.',
      run: (b) =>
        findResources(b, 'aws_lambda_function').some((f) => f.attributes['timeout'] !== undefined),
    },
  ],
};

const MODEL_SERVING: GradedTask = {
  id: 'task_model_serving_v1',
  capabilities: ['cost_control', 'observability_and_alerting'],
  track: 'mlops',
  title: 'Serve a model without it drifting silently or billing you all night',
  timeboxMinutes: 40,
  brief: (p) => [
    'Write Terraform to serve one trained model behind a SageMaker real-time endpoint.',
    `Name the model ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'A colleague must be able to redeploy the exact same model in a year and get the same bytes, so write the container image URI out in full rather than through a variable.',
    'You need to be able to tell later what the model was actually asked and what it answered.',
    'The endpoint is always on, so its cost must not scale only with how busy you are.',
    'Paste the Terraform below. No modules, no variables file, no provider block needed.',
  ],
  identity: {
    requirement: 'The model is named as the brief specifies',
    missing:
      'The model name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_model').some((m) =>
        (stringAttr(m, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'model',
      requirement: 'A SageMaker model',
      missing: 'No aws_sagemaker_model resource was found.',
      matters: 'Everything else in the task attaches to it.',
      run: (b) => findResources(b, 'aws_sagemaker_model').length > 0,
    },
    {
      id: 'pinned_image',
      requirement: 'A container image pinned to a digest or an explicit tag',
      missing:
        'The model image is missing, written through a variable, untagged, or tagged :latest.',
      matters:
        'An untagged or :latest image means the model you serve next month is not the model you tested. Reproducibility is the whole job, and this is where it is usually lost.',
      run: (b) => {
        const images = modelImages(b);
        return images.length > 0 && images.every(isPinnedImage);
      },
    },
    {
      id: 'endpoint',
      requirement: 'An endpoint configuration with a production variant',
      missing:
        'No aws_sagemaker_endpoint_configuration with a production_variants block was found.',
      matters: 'The variant is where instance type, count and traffic share are actually decided.',
      run: (b) => {
        const configs = findResources(b, 'aws_sagemaker_endpoint_configuration');
        return configs.some((c) => findNested(c, 'production_variants').length > 0);
      },
    },
    {
      id: 'data_capture',
      requirement: 'Data capture enabled on the endpoint',
      missing: 'No data_capture_config with enable_capture set true was found.',
      matters:
        'Without captured requests and responses you cannot tell that a model has drifted, only that something downstream got worse. This is the check that separates people who have run a model in production from people who have deployed one.',
      run: (b) => {
        const configs = findResources(b, 'aws_sagemaker_endpoint_configuration');
        return configs.some((c) =>
          findNested(c, 'data_capture_config').some(
            (dc) => boolAttr(dc, 'enable_capture') === true,
          ),
        );
      },
    },
    {
      id: 'autoscaling',
      requirement: 'Autoscaling on the endpoint variant',
      missing: 'No aws_appautoscaling_target for a sagemaker variant was found.',
      matters:
        'A real-time endpoint runs whether or not anyone calls it. Fixed capacity means paying peak all night, or falling over at noon.',
      run: (b) => {
        const targets = findResources(b, 'aws_appautoscaling_target');
        if (targets.length === 0) return false;
        return targets.some((t) => {
          const ns = stringAttr(t, 'service_namespace');
          return ns === null || ns.toLowerCase() === 'sagemaker';
        });
      },
    },
  ],
};

/**
 * The second MLOps task, and deliberately about a different failure than the
 * first.
 *
 * Serving a model badly costs money and goes unnoticed. Getting the feature
 * path wrong is worse: the model looks excellent in training and is quietly
 * wrong in production, because it was trained on information that did not
 * exist at prediction time. Training/serving skew and label leakage are the
 * two most expensive mistakes in applied ML, and neither shows up as an
 * error anywhere.
 *
 * The brief states the OUTCOME in plain terms and never names the mechanism.
 * Somebody who has fought a skew bug will reach for an event time and a
 * paired online/offline store without being told; somebody who has only
 * deployed a model will not. That is the whole discrimination, and it is why
 * the brief is worded the way it is.
 */
const FEATURE_PATH: GradedTask = {
  id: 'task_feature_path_v1',
  capabilities: ['reproducible_data_path'],
  track: 'mlops',
  title: 'Build a feature path that training and serving both read from',
  timeboxMinutes: 40,
  brief: (p) => [
    'Write Terraform for the place your model reads its input features from, using SageMaker Feature Store.',
    `Name the feature group ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'The model is scored live on one customer at a time, and is retrained in bulk from history, and both must read the same feature definitions.',
    'When you assemble a training example for a customer as they were last March, it must not be able to see anything recorded after that moment.',
    'Every row must be attributable to the customer it describes.',
    'At least two feature definitions, so the shape is real. Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The feature group is named as the brief specifies',
    missing:
      'The feature group name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_feature_group').some((g) =>
        (stringAttr(g, 'feature_group_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'feature_group',
      requirement: 'A feature group with at least two feature definitions',
      missing:
        'No aws_sagemaker_feature_group with two or more feature_definition blocks was found.',
      matters: 'Everything else in the task hangs off it, and one column is not a feature path.',
      run: (b) => {
        const groups = findResources(b, 'aws_sagemaker_feature_group');
        return groups.some((g) => findNested(g, 'feature_definition').length >= 2);
      },
    },
    {
      id: 'record_identifier',
      requirement: 'A record identifier',
      missing: 'record_identifier_feature_name is not set on the feature group.',
      matters:
        'Without it a row cannot be tied back to the customer it describes, so neither lookup nor retraining can find anything.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_feature_group').some(
          (g) => stringAttr(g, 'record_identifier_feature_name') !== null,
        ),
    },
    {
      id: 'event_time',
      requirement: 'An event time feature',
      missing: 'event_time_feature_name is not set on the feature group.',
      matters:
        'This is the one that decides whether the model is honest. Without an event time there is no way to assemble a training example as it stood at a past moment, so training silently sees data from after the prediction it is learning to make. The model looks excellent in evaluation and is wrong in production.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_feature_group').some(
          (g) => stringAttr(g, 'event_time_feature_name') !== null,
        ),
    },
    {
      id: 'online_store',
      requirement: 'An online store, for scoring one customer live',
      missing: 'No online_store_config with enable_online_store set true was found.',
      matters: 'Low-latency lookup is what the live path needs, and the brief asked for it.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_feature_group').some((g) =>
          findNested(g, 'online_store_config').some(
            (o) => boolAttr(o, 'enable_online_store') === true,
          ),
        ),
    },
    {
      id: 'offline_store',
      requirement: 'An offline store, for retraining from history',
      missing: 'No offline_store_config with an S3 location was found.',
      matters:
        'Retraining reads history in bulk. Pointing it at a separate pipeline is exactly how the two paths drift apart, which is the skew the brief rules out.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_feature_group').some((g) =>
          findNested(g, 's3_storage_config').some((cfg) => stringAttr(cfg, 's3_uri') !== null),
        ),
    },
  ],
};

/**
 * The third MLOps task, and the one that closes the loop the first opened.
 *
 * Task one requires data capture, which collects what the model was asked
 * and what it answered. Collecting it is the easy half. The common
 * half-measure is a system quietly filling a bucket nobody ever opens: the
 * capture box is ticked, the dashboard exists, and the first anybody hears
 * of a broken model is a business metric moving weeks later.
 *
 * This asks for the other half — something that compares live traffic
 * against training on its own schedule, writes its findings somewhere
 * durable, and does not itself become an unbounded bill. Resource shapes
 * confirmed against the AWS provider's own documentation before the task
 * was written, because setting somebody Terraform that cannot exist would be
 * indefensible.
 */
const MODEL_MONITORING: GradedTask = {
  id: 'task_model_monitoring_v1',
  capabilities: ['observability_and_alerting'],
  track: 'mlops',
  title: 'Notice the model has gone wrong before a person does',
  timeboxMinutes: 40,
  brief: (p) => [
    'A model is already live behind a SageMaker endpoint and is already capturing what it is asked and what it answers. Nobody looks at any of it.',
    `Name the monitoring schedule ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Write Terraform so that live traffic is compared against what the model saw in training, on a recurring basis, without anybody remembering to start it.',
    'When it finds something, the finding must survive somewhere a person can go back to later.',
    'The comparison is itself a compute job, so what it costs to run must be bounded and visible.',
    'Paste the Terraform below. Assume the endpoint and an execution role already exist.',
  ],
  identity: {
    requirement: 'The monitoring schedule is named as the brief specifies',
    missing:
      'The monitoring schedule name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_monitoring_schedule').some((m) =>
        (stringAttr(m, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'job_definition',
      requirement: 'A job definition saying what to compare',
      missing: 'No aws_sagemaker_data_quality_job_definition resource was found.',
      matters: 'A schedule with nothing to run is a calendar entry, not a check.',
      run: (b) => findResources(b, 'aws_sagemaker_data_quality_job_definition').length > 0,
    },
    {
      id: 'watches_endpoint',
      requirement: 'The job watches the live endpoint',
      missing: 'No data_quality_job_input with an endpoint_input naming an endpoint was found.',
      matters:
        'Pointed at anything other than the traffic the model is actually serving, it reports on a system nobody is using.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_data_quality_job_definition').some((d) =>
          findNested(d, 'endpoint_input').some((e) => e.attributes['endpoint_name'] !== undefined),
        ),
    },
    {
      id: 'findings_output',
      requirement: 'Findings written somewhere durable',
      missing: 'No data_quality_job_output_config with an s3_output location was found.',
      matters:
        'A finding that exists only in a job log is gone by the time somebody asks what changed and when.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_data_quality_job_definition').some((d) =>
          findNested(d, 's3_output').some((o) => stringAttr(o, 's3_uri') !== null),
        ),
    },
    {
      id: 'bounded_resources',
      requirement: 'The monitoring job has bounded compute',
      missing:
        'No job_resources with a cluster_config naming an instance type and count was found.',
      matters:
        'The check is a compute job of its own. Left unspecified it is a recurring cost nobody attributed to anything.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_data_quality_job_definition').some((d) =>
          findNested(d, 'cluster_config').some(
            (c) =>
              c.attributes['instance_type'] !== undefined &&
              c.attributes['instance_count'] !== undefined,
          ),
        ),
    },
    {
      id: 'schedule',
      requirement: 'A schedule that runs it, wired to the job definition',
      missing:
        'No aws_sagemaker_monitoring_schedule with a monitoring_schedule_config naming a monitoring_job_definition_name and a monitoring_type was found.',
      matters:
        'This is the difference between monitoring and having meant to. Without it the job exists and never runs.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_monitoring_schedule').some((m) =>
          findNested(m, 'monitoring_schedule_config').some(
            (c) =>
              c.attributes['monitoring_job_definition_name'] !== undefined &&
              c.attributes['monitoring_type'] !== undefined,
          ),
        ),
    },
  ],
};

/**
 * The fourth MLOps task, and the only one not about a model's behaviour.
 *
 * The first three all concern one model that is already in production:
 * serving it, feeding it, watching it. Every one of them can be right while
 * the deeper problem stands, which is that nothing decided this model should
 * be the one in production at all. No versioned home, no deliberate
 * promotion, no way to answer "which one is live" or "put back the one from
 * last Tuesday".
 *
 * Checks 3 and 4 read the whole submission rather than the policy resource
 * alone, because a resource policy is almost always assembled in a separate
 * aws_iam_policy_document and referenced, and this reader deliberately does
 * not evaluate expressions. Grading only the resource would fail people for
 * writing it the ordinary way.
 */
const MODEL_GOVERNANCE: GradedTask = {
  id: 'task_model_governance_v1',
  capabilities: ['safe_release'],
  track: 'mlops',
  title: 'Make putting a model in production a decision somebody made',
  timeboxMinutes: 40,
  brief: (p) => [
    'Today anyone can point production at any artifact they built, and afterwards nobody can say which version is serving or get back to the one before it.',
    `Name the model package group ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Write Terraform giving trained models a versioned home that production draws from.',
    'Promoting a version must be a deliberate act that only named people can perform, not a side effect of somebody writing a file.',
    'What production serves must be a version from that home, not an artifact uploaded beside it.',
    'Paste the Terraform below. Assume an execution role and a trained artifact already exist.',
  ],
  identity: {
    requirement: 'The model package group is named as the brief specifies',
    missing:
      'The model package group name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_model_package_group').some((g) =>
        (stringAttr(g, 'model_package_group_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'registry',
      requirement: 'A model package group, as the versioned home',
      missing: 'No aws_sagemaker_model_package_group resource was found.',
      matters:
        'Without one there is no list of versions to promote from, and "which model is live" has no answer anybody can look up.',
      run: (b) => findResources(b, 'aws_sagemaker_model_package_group').length > 0,
    },
    {
      id: 'registry_policy',
      requirement: 'A resource policy on that group',
      missing: 'No aws_sagemaker_model_package_group_policy with a resource_policy was found.',
      matters:
        'A registry anyone can write to records what happened without controlling it. The policy is the part that makes promotion a decision.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_model_package_group_policy').some(
          (r) => r.attributes['resource_policy'] !== undefined,
        ),
    },
    {
      id: 'approval_action',
      requirement: 'The policy governs the action that actually approves a version',
      missing:
        'Nothing in the submission mentions sagemaker:UpdateModelPackage, which is the call that changes a version to Approved.',
      matters:
        'Governing Describe and List controls who can read the registry, not who can promote from it. The gate has to sit on the approval itself.',
      run: (b) => rawText(b).includes('sagemaker:UpdateModelPackage'),
    },
    {
      id: 'named_principal',
      requirement: 'The policy names who may do it',
      missing:
        'The policy does not name a specific principal. Nothing in the submission references an account id or an IAM ARN.',
      matters:
        'A policy open to everyone is not a gate. Naming the account or role is what turns a record of promotions into control over them.',
      run: (b) => {
        const text = rawText(b);
        return (
          text.includes('aws_caller_identity') ||
          text.includes('arn:aws:iam::') ||
          text.includes('account_id')
        );
      },
    },
    {
      id: 'served_from_registry',
      requirement: 'Production serves a version from the registry',
      missing:
        'No aws_sagemaker_model whose container sets model_package_name was found. A container built from a raw image and artifact bypasses the registry entirely.',
      matters:
        'This is the check the whole task turns on. A registry nothing deploys from is a filing cabinet: the versions are recorded, and production is still serving whatever somebody uploaded.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_model').some((m) =>
          [...findNested(m, 'primary_container'), ...findNested(m, 'container')].some(
            (c) => c.attributes['model_package_name'] !== undefined,
          ),
        ),
    },
  ],
};

/**
 * The fifth MLOps task, and the first about training rather than inference.
 *
 * The other four all concern a model that already exists: serving it,
 * feeding it, watching it, deciding it may ship. Nothing covered how it came
 * to exist, which is where the largest bills and the worst data incidents
 * both live. A training job that stalls holds GPU instances until somebody
 * notices, and a training container with open egress is reading your most
 * sensitive data with nothing stopping it leaving.
 *
 * Written after checking the provider docs and finding aws_sagemaker_training_job
 * does exist, contrary to an earlier assumption made while planning the
 * third task. Assuming it away is why training went uncovered for four
 * tasks.
 */
const TRAINING_RUN: GradedTask = {
  id: 'task_training_run_v1',
  capabilities: ['cost_control', 'data_protection'],
  track: 'mlops',
  title: 'Train on sensitive data without leaving a GPU running all weekend',
  timeboxMinutes: 40,
  brief: (p) => [
    'Write Terraform for one SageMaker training job that learns from customer records.',
    `Name the training job ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'If the job stalls, it must stop on its own rather than when somebody notices the bill.',
    'What it produces has to outlive the run.',
    'The records it reads must not be able to leave: the container should have no route to the open internet.',
    'A reader should be able to tell what a single run costs at worst.',
    'Paste the Terraform below. Assume the role, subnets and security groups already exist.',
  ],
  identity: {
    requirement: 'The training job is named as the brief specifies',
    missing:
      'The training job name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_training_job').some((j) =>
        (stringAttr(j, 'training_job_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'training_job',
      requirement: 'A training job with an algorithm specification',
      missing:
        'No aws_sagemaker_training_job with an algorithm_specification naming a training image was found.',
      matters:
        'Everything else in the task hangs off it, and a job with no algorithm trains nothing.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_training_job').some((j) =>
          findNested(j, 'algorithm_specification').some(
            (a) => a.attributes['training_image'] !== undefined,
          ),
        ),
    },
    {
      id: 'runtime_ceiling',
      requirement: 'A ceiling on how long the run may take',
      missing: 'No stopping_condition with max_runtime_in_seconds was found.',
      matters:
        'This is the one that decides whether a stalled run costs an hour or a weekend. A training job that hangs holds its instances until a person happens to look, and GPU instances are the most expensive thing in the account to leave running.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_training_job').some((j) =>
          findNested(j, 'stopping_condition').some(
            (c) => c.attributes['max_runtime_in_seconds'] !== undefined,
          ),
        ),
    },
    {
      id: 'sized_compute',
      requirement: 'Compute chosen deliberately, not defaulted',
      missing: 'No resource_config naming an instance_type and instance_count was found.',
      matters:
        'Without it nobody can say what one run costs before starting it, which is how training budgets are discovered after the fact.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_training_job').some((j) =>
          findNested(j, 'resource_config').some(
            (r) =>
              r.attributes['instance_type'] !== undefined &&
              r.attributes['instance_count'] !== undefined,
          ),
        ),
    },
    {
      id: 'durable_output',
      requirement: 'The trained artifact written somewhere it survives',
      missing: 'No output_data_config with an s3_output_path was found.',
      matters:
        'The instance is gone when the job ends. An artifact that was only ever on it went with it, and the run has to be paid for again to get it back.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_training_job').some((j) =>
          findNested(j, 'output_data_config').some(
            (o) => o.attributes['s3_output_path'] !== undefined,
          ),
        ),
    },
    {
      id: 'contained_network',
      requirement: 'The training container placed in a network you control',
      missing: 'No vpc_config naming both subnets and security_group_ids was found.',
      matters:
        'A training container reads the most sensitive data the company has. Left with a default route out, nothing but good intentions stops that data leaving, and no audit afterwards can prove it did not.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_training_job').some((j) =>
          findNested(j, 'vpc_config').some(
            (v) =>
              v.attributes['subnets'] !== undefined &&
              v.attributes['security_group_ids'] !== undefined,
          ),
        ),
    },
  ],
};

/**
 * The sixth MLOps task, about the half of production ML that is not a
 * request/response.
 *
 * Task one is a real-time endpoint: a caller waits, and a failure is visible
 * to whoever was waiting. Asynchronous inference has no such caller. Work is
 * queued, answered later, and a failure is only ever seen by whatever was
 * told to look. Configured without a failure destination and a notification,
 * a rejected payload leaves no trace at all: no exception surfaces, no
 * dashboard moves, and the first anybody hears of it is a customer asking
 * where their result went.
 *
 * The failure-path check deliberately matches on the concept rather than one
 * exact spelling. Being unsure whether the argument is s3_failure_path or
 * s3_failure_output_path is a poor reason to fail somebody who did the right
 * thing, and the rubric should not test recall of an argument name.
 */
const ASYNC_INFERENCE: GradedTask = {
  id: 'task_async_inference_v1',
  capabilities: ['failure_handling'],
  track: 'mlops',
  title: 'Score a queue of work without losing the failures',
  timeboxMinutes: 40,
  brief: (p) => [
    'A model scores documents that take too long for a caller to wait on, so requests are queued and answered later.',
    `Name the endpoint configuration ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Nobody is waiting on the other end, so anything that goes wrong has to be recorded rather than raised.',
    'A request that fails must leave a trace somebody can find, and something must be told it happened without a person checking.',
    'One heavy batch must not be able to saturate an instance and starve everything behind it.',
    'Paste the Terraform below. Assume the model and any topics already exist.',
  ],
  identity: {
    requirement: 'The endpoint configuration is named as the brief specifies',
    missing:
      'The endpoint configuration name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_endpoint_configuration').some((c) =>
        (stringAttr(c, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'async_endpoint',
      requirement: 'An endpoint configured for asynchronous inference',
      missing: 'No aws_sagemaker_endpoint_configuration with an async_inference_config was found.',
      matters:
        'A real-time endpoint makes the caller wait, which is what the brief rules out. This is a different serving shape, not a setting on the same one.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint_configuration').some(
          (c) => findNested(c, 'async_inference_config').length > 0,
        ),
    },
    {
      id: 'results_destination',
      requirement: 'Somewhere for successful results to land',
      missing: 'No output_config with an S3 output path was found.',
      matters:
        'Nobody is holding the connection, so a result that is not written down is a result nobody can collect.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint_configuration').some((c) =>
          findNested(c, 'output_config').some((o) => hasAttrMatching(o, /^s3_output/)),
        ),
    },
    {
      id: 'failure_destination',
      requirement: 'Somewhere for failures to land, separate from successes',
      missing: 'No failure path was found on the output config.',
      matters:
        'This is the one that decides whether a rejected payload is investigable or simply gone. Successes land somewhere by default in most designs; failures only land where somebody put them.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint_configuration').some((c) =>
          findNested(c, 'output_config').some((o) => hasAttrMatching(o, /failure/i)),
        ),
    },
    {
      id: 'failure_notification',
      requirement: 'Something told when an inference fails',
      missing: 'No notification_config with an error topic was found.',
      matters:
        'A failure path nobody is watching is an archive, not an alert. Without a topic, the first anybody hears of it is a customer asking where their result went.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint_configuration').some((c) =>
          findNested(c, 'notification_config').some((n) => hasAttrMatching(n, /error/i)),
        ),
    },
    {
      id: 'concurrency_ceiling',
      requirement: 'A ceiling on concurrent invocations per instance',
      missing: 'No client_config with max_concurrent_invocations_per_instance was found.',
      matters:
        'Queued work arrives in bursts. Without a ceiling one heavy batch saturates an instance and everything behind it waits, which looks like an outage to every other caller.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint_configuration').some((c) =>
          findNested(c, 'client_config').some((cc) =>
            hasAttrMatching(cc, /max_concurrent_invocations/),
          ),
        ),
    },
  ],
};

/**
 * The seventh MLOps task, and the only one about the moment of replacement.
 *
 * The other six all concern a model in a steady state: serving it, feeding
 * it, watching it, deciding it may ship, training it, queueing work for it.
 * None of them covers the cutover, which is where the outages actually
 * happen. Deploying a first model is a green field. Replacing a live one is
 * the act with a blast radius, and it is the clearest line between somebody
 * who has run a model in production and somebody who has launched one.
 *
 * The rubric leans on that line deliberately. Pointing an endpoint at a new
 * endpoint configuration is a one-attribute change that reads as done and
 * cuts every caller over at once. Everything below asks what happens in the
 * minutes after that change, which is a question the one-attribute answer
 * has never had to consider.
 *
 * staged_deployment is subsumed by gradual_traffic_shift: a traffic routing
 * configuration cannot exist outside a deployment config, so anything passing
 * the second passes the first. It is kept anyway, and the same shape appears
 * on the async task. The checks are a diagnostic as well as a score, and a
 * candidate who submitted a bare endpoint is better served by being told the
 * deployment config is missing than by being told a nested block inside it is.
 *
 * Block and argument names checked against the provider docs before writing,
 * per the lesson recorded on the training task.
 */
const SAFE_ROLLOUT: GradedTask = {
  id: 'task_safe_rollout_v1',
  capabilities: ['safe_release'],
  track: 'mlops',
  title: 'Replace a live model without a blind cutover',
  timeboxMinutes: 40,
  brief: (p) => [
    'A model is already serving live traffic and a new version has been approved to replace it.',
    `Name the endpoint ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'The new version has been tested offline. Offline is not production, so assume it may still be worse.',
    'Callers must not all be moved onto it at the same instant.',
    'If it turns out to be worse, going back must not depend on somebody being awake to notice.',
    'Whatever decides "worse" has to be measuring the model, not the machine it runs on.',
    'Paste the Terraform below. Assume the model, both endpoint configurations, and an execution role already exist.',
  ],
  identity: {
    requirement: 'The endpoint is named as the brief specifies',
    missing:
      'The endpoint name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_endpoint').some((e) =>
        (stringAttr(e, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'staged_deployment',
      requirement: 'The endpoint has a deployment config governing updates',
      missing: 'No aws_sagemaker_endpoint with a deployment_config block was found.',
      matters:
        'Without one, changing endpoint_config_name replaces the fleet in place. That is a single attribute edit that looks like a deployment and behaves like a cutover.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint').some(
          (e) => findNested(e, 'deployment_config').length > 0,
        ),
    },
    {
      id: 'gradual_traffic_shift',
      requirement: 'Traffic moves across in stages rather than all at once',
      missing:
        'No traffic_routing_configuration with a CANARY or LINEAR type was found. ALL_AT_ONCE moves every caller in one step.',
      matters:
        'This is the check the task turns on. A staged shift means the first people to meet a bad model are a slice you chose, and the rest are still on the version that works. ALL_AT_ONCE means the blast radius is everybody, and the config exists only to describe how fast that happened.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint').some((e) =>
          findNested(e, 'traffic_routing_configuration').some((t) => {
            const type = (stringAttr(t, 'type') ?? '').toUpperCase();
            return type === 'CANARY' || type === 'LINEAR';
          }),
        ),
    },
    {
      id: 'automatic_rollback',
      requirement: 'Going back is automatic, wired to at least one alarm',
      missing: 'No auto_rollback_configuration naming an alarm was found.',
      matters:
        'A staged rollout nobody is watching is a slower outage, not a safer one. The alarm is what turns the stages into decision points instead of a countdown.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint').some((e) =>
          findNested(e, 'auto_rollback_configuration').some(
            (r) => findNested(r, 'alarms').length > 0 || hasAttrMatching(r, /alarm/i),
          ),
        ),
    },
    {
      id: 'alarm_measures_the_model',
      requirement: 'The alarm watches the model behaving badly, not the host',
      missing:
        'No aws_cloudwatch_metric_alarm on a model-level metric was found. CPUUtilization, MemoryUtilization and DiskUtilization describe the instance, not the model.',
      matters:
        'This is the one that separates a rollout that works from one that only looks like it does. A bad model answers wrongly at completely normal CPU. Roll back on host metrics and the rollout completes cleanly while the model gets every prediction wrong.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_metric_alarm').some((a) =>
          /^(ModelLatency|OverheadLatency|Invocation4XXErrors|Invocation5XXErrors|InvocationModelErrors|ModelSetupTime)$/i.test(
            stringAttr(a, 'metric_name') ?? '',
          ),
        ),
    },
    {
      id: 'old_fleet_retained',
      requirement: 'The previous fleet is kept alive for a while after the shift',
      missing:
        'termination_wait_in_seconds is absent or zero, so the old fleet is torn down as soon as traffic finishes moving.',
      matters:
        'Rolling back means sending traffic somewhere, and that somewhere is the old fleet. Tear it down the instant the shift completes and the rollback you configured has nothing to return to for any problem that surfaces a minute later.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_endpoint').some((e) =>
          findNested(e, 'blue_green_update_policy').some((pol) => {
            const raw = attrAnywhere(pol, 'termination_wait_in_seconds');
            return raw !== null && raw.kind === 'number' && raw.value > 0;
          }),
        ),
    },
  ],
};

/**
 * The eighth MLOps task, and the one that closes the loop the other seven
 * leave open.
 *
 * The monitoring task detects that a model has drifted. Nothing in the set
 * responds to it. A drift finding that lands in a bucket nobody reads is the
 * same outcome as no monitoring at all, and the gap between noticing and
 * acting is where models quietly rot in production.
 *
 * The trap here is the opposite of the usual one. Most tasks catch somebody
 * who automated too little. This one also has to catch somebody who automated
 * too much: a pipeline that retrains on a signal and pushes the result
 * straight at the endpoint has not built a safety net, it has automated the
 * accident and removed the person who would have caught it. Retraining is
 * only safe when the new model lands somewhere a human still has to approve
 * it from, which is the registry the governance task already established.
 *
 * So the rubric grades the seam between automatic and deliberate: everything
 * up to the registry may run unattended, and nothing past it may.
 *
 * Resource and argument names checked against the provider docs before
 * writing, per the lesson recorded on the training task.
 */
const RETRAINING_LOOP: GradedTask = {
  id: 'task_retraining_loop_v1',
  capabilities: ['safe_release', 'reproducible_data_path'],
  track: 'mlops',
  title: 'Retrain a drifting model without letting it deploy itself',
  timeboxMinutes: 40,
  brief: (p) => [
    'A live model is already monitored, and the monitoring already reports when its inputs have drifted. Today a person reads that report, and usually nobody does.',
    `Name the pipeline ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Retraining must not depend on somebody remembering to start it.',
    'A retrained model is not automatically a better one, so nothing should reach production on the strength of having been retrained.',
    'Whether the new model is good enough is a question the pipeline can answer. Whether it ships is not.',
    'Paste the Terraform below. Assume the endpoint, the monitoring schedule, the model package group, and an execution role already exist.',
  ],
  identity: {
    requirement: 'The pipeline is named as the brief specifies',
    missing:
      'The pipeline name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_pipeline').some((pl) =>
        (stringAttr(pl, 'pipeline_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'orchestrated_retrain',
      requirement: 'The retrain is a defined pipeline, not a script somebody runs',
      missing:
        'No aws_sagemaker_pipeline with a pipeline_definition or a pipeline_definition_s3_location was found.',
      matters:
        'A retrain that lives in a notebook on one laptop is not repeatable and cannot be triggered by anything. Defining it is what makes every check below possible.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_pipeline').some(
          (pl) =>
            pl.attributes['pipeline_definition'] !== undefined ||
            findNested(pl, 'pipeline_definition_s3_location').length > 0,
        ),
    },
    {
      id: 'runs_unattended',
      requirement: 'Something starts it without a person',
      missing:
        'Nothing in the submission starts the pipeline. A rule with no target fires into nothing, so this looks for a target or a schedule that names the pipeline.',
      matters:
        'This is the whole point of the task. Retraining that waits for somebody to remember is the process you already have, written down. The drift report is already being produced and already being ignored.',
      run: (b) => {
        // A rule on its own fires into nothing. What makes this real is
        // something that actually points at the pipeline, so the check looks
        // for a target or a schedule and then for the pipeline inside it.
        const starters = [
          ...findResources(b, 'aws_cloudwatch_event_target'),
          ...findResources(b, 'aws_scheduler_schedule'),
        ];
        return (
          starters.length > 0 &&
          /aws_sagemaker_pipeline|StartPipelineExecution/i.test(rawText(starters))
        );
      },
    },
    {
      id: 'quality_gate',
      requirement: 'The pipeline decides whether the new model is good enough',
      missing:
        'No condition or quality-evaluation step was found in the pipeline definition. Nothing stops a worse model proceeding.',
      matters:
        'Retraining on drifted data can produce a model worse than the one running. Without a gate the pipeline faithfully carries that model forward, and the automation has made the problem arrive faster.',
      run: (b) =>
        /"(ConditionStep|QualityCheck|ClarifyCheck)"|Type\s*[=:]\s*"Condition"/i.test(rawText(b)),
    },
    {
      id: 'registers_not_deploys',
      requirement: 'A model that passes goes to the registry',
      missing:
        'No RegisterModel step was found in the pipeline definition. Nothing puts the retrained model anywhere a person can promote it from.',
      matters:
        'The registry is the seam between automatic and deliberate. Registering means the pipeline has done everything it safely can and stopped where a decision starts.',
      run: (b) => /RegisterModel/i.test(rawText(b)),
    },
    {
      id: 'approval_stays_manual',
      requirement: 'The registered version waits for a person',
      missing:
        'The submission does not set PendingManualApproval. A version registered as Approved is a version that can ship without anybody deciding it should.',
      matters:
        'This is the check that separates a safety net from an automated accident. Retrain, evaluate, register, approve and deploy with no human in the chain means the first person to learn the model changed is a customer, and the pipeline will do it again tomorrow.',
      run: (b) => /PendingManualApproval/i.test(rawText(b)),
    },
  ],
};

/**
 * The ninth MLOps task, and the earliest one in the life of a model.
 *
 * The other eight all begin with a model that exists: training it, serving
 * it, watching it, replacing it, retraining it. None covers the room the
 * work happens in. That room is a SageMaker Studio domain, and it is where
 * the two worst ML incidents both start. Its home directories accumulate
 * copies of whatever data people are working on, so an unencrypted domain is
 * a permanent unencrypted copy of the training set. And a notebook nobody
 * shut down is the most reliable runaway bill in the category, because the
 * instance is idle rather than broken and nothing alerts on healthy.
 *
 * Two checks here are deliberately not graded, because the provider requires
 * subnet_ids and vpc_id on the resource itself. A check nobody can fail is
 * not a check, and grading one would inflate every score by a mark. What is
 * graded instead is the part a candidate can leave out and often does: the
 * network access type, which defaults to public, and the security groups,
 * whose absence hands the workbench the VPC default and its open egress.
 *
 * studio_domain is subsumed by the identity gate, the same as the model
 * package group on the governance task. It is kept for its diagnostic
 * message, which is what a candidate who submitted something else entirely
 * needs to read.
 *
 * Argument names and the idle-shutdown nesting path checked against the
 * provider docs before writing, per the lesson recorded on the training task.
 */
const MODEL_WORKBENCH: GradedTask = {
  id: 'task_model_workbench_v1',
  capabilities: ['network_isolation', 'cost_control'],
  track: 'mlops',
  title: 'Give the team a workbench that is not on the internet and does not run all month',
  timeboxMinutes: 40,
  brief: (p) => [
    'Four people are about to start building models against customer data, and they need somewhere to work.',
    `Name the domain ${p.token}. That name is yours; a submission using a different one is graded as somebody else's.`,
    'Whatever they open, their working copies of that data live in the domain and outlive any one session.',
    'The workbench must not be able to reach the public internet, and must not be reachable from it.',
    'Assume they will forget to close things. Assume nobody is watching the bill.',
    'Paste the Terraform below. Assume the VPC, its subnets, a KMS key, and an execution role already exist.',
  ],
  identity: {
    requirement: 'The domain is named as the brief specifies',
    missing:
      'The domain name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sagemaker_domain').some((d) =>
        (stringAttr(d, 'domain_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'studio_domain',
      requirement: 'A Studio domain with user settings',
      missing: 'No aws_sagemaker_domain with a default_user_settings block was found.',
      matters:
        'The domain is the thing being asked for. Without default_user_settings there is nothing to attach a role, a network, or a shutdown policy to.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_domain').some(
          (d) => findNested(d, 'default_user_settings').length > 0,
        ),
    },
    {
      id: 'no_direct_internet',
      requirement: 'The workbench has no direct route to the internet',
      missing:
        'app_network_access_type is absent or not VpcOnly. Left out, it defaults to PublicInternetOnly.',
      matters:
        'This is the check the task turns on, and the one most often missed, because leaving it out produces a domain that works perfectly. The default gives every notebook a path straight out, so anything opened in it can post the data it is holding anywhere.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_domain').some(
          (d) => (stringAttr(d, 'app_network_access_type') ?? '').toLowerCase() === 'vpconly',
        ),
    },
    {
      id: 'egress_controlled',
      requirement: 'The user settings name security groups',
      missing: 'No security_groups were named in default_user_settings.',
      matters:
        'VpcOnly decides the route, security groups decide what may travel it. Naming none leaves the workbench on the VPC default group, which conventionally allows everything outbound, so the network restriction is announced and not enforced.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_domain').some((d) =>
          findNested(d, 'default_user_settings').some(
            (u) => u.attributes['security_groups'] !== undefined,
          ),
        ),
    },
    {
      id: 'home_storage_encrypted',
      requirement: 'The domain storage is encrypted with a key you name',
      missing: 'No kms_key_id was set on the domain.',
      matters:
        'Every notebook writes its working copies into the domain home directories, and they outlive the session that made them. Unencrypted, the domain is a lasting plaintext copy of whatever the team has been reading.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_domain').some(
          (d) => d.attributes['kms_key_id'] !== undefined,
        ),
    },
    {
      id: 'idle_shutdown',
      requirement: 'Idle applications shut themselves down',
      missing:
        'No idle_timeout_in_minutes was found. It nests under an app settings block, in app_lifecycle_management then idle_settings.',
      matters:
        'This is the most reliable runaway bill in machine learning, and it never triggers an alarm, because an idle instance is healthy and simply expensive. Somebody opens a notebook on a Thursday, goes on leave, and the instance bills until a person happens to look.',
      run: (b) =>
        findResources(b, 'aws_sagemaker_domain').some((d) => {
          const idle = attrAnywhere(d, 'idle_timeout_in_minutes');
          return idle !== null && idle.kind === 'number' && idle.value > 0;
        }),
    },
  ],
};

/**
 * The second cloud-security task, and the one closest to how breaches
 * actually begin.
 *
 * The bucket task covers data at rest. This one covers the way in. An ingress
 * rule allowing 0.0.0.0/0 to a database is the most common serious
 * misconfiguration in the category, and it is almost never written
 * deliberately. It is what somebody reaches for when a connection fails and
 * they want to rule the group out, and then it stays, because it works.
 *
 * Graded across both spellings of a rule. Inline blocks and the separate
 * aws_vpc_security_group_rule resources are both current, and the split
 * resources are the ones the provider now recommends.
 */
const NETWORK_EXPOSURE: GradedTask = {
  id: 'task_network_exposure_v1',
  capabilities: ['auditability', 'observability_and_alerting'],
  track: 'cloud_security',
  title: 'Put a database somewhere the whole internet cannot reach it',
  timeboxMinutes: 35,
  brief: (p) => [
    'A database holding customer records needs to accept connections from one application and from nothing else.',
    'Name the security group ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'The application already has its own security group.',
    'Say which traffic may arrive and where it may arrive from, as narrowly as the job allows.',
    'Say what the database may reach on its way out, too. It has no reason to start conversations with the internet.',
    'Paste the Terraform below. Assume the VPC and the application security group already exist.',
  ],
  identity: {
    requirement: 'The security group is named as the brief specifies',
    missing:
      'The security group name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_security_group').some((g) =>
        (stringAttr(g, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'security_group',
      requirement: 'A security group with at least one rule',
      missing: 'No aws_security_group with any ingress or egress rule was found.',
      matters:
        'A group with no rules allows nothing in and nothing out. It is not wrong, it is just not the thing being asked for.',
      run: (b) => ingressRules(b).length > 0 || egressRules(b).length > 0,
    },
    {
      id: 'nothing_open_to_the_world',
      requirement: 'No rule admits the whole internet',
      missing:
        'An ingress rule allows 0.0.0.0/0 or ::/0. That opens the database to every host that can route to it.',
      matters:
        'This is the check the task turns on, and the single most common serious misconfiguration in cloud security. It is rarely deliberate: somebody widens the group to prove it is not the cause of a failure, the connection works, and it is never narrowed again.',
      run: (b) =>
        ingressRules(b).every((r) => !ruleCidrs(r).some((c) => OPEN_TO_THE_WORLD.includes(c))),
    },
    {
      id: 'source_is_named',
      requirement: 'Traffic is admitted from a named source, not a range',
      missing:
        'No ingress rule references another security group. Nothing ties the database to the one application allowed to reach it.',
      matters:
        'A CIDR describes where something sits, a group describes what it is. Referencing the application group keeps the rule correct when the application moves, scales, or gets new addresses, which a hand-written range does not.',
      run: (b) =>
        ingressRules(b).some(
          (r) =>
            r.attributes['referenced_security_group_id'] !== undefined ||
            r.attributes['security_groups'] !== undefined ||
            r.attributes['source_security_group_id'] !== undefined,
        ),
    },
    {
      id: 'ports_are_narrow',
      requirement: 'Rules name the port the database uses, not every port',
      missing:
        'An ingress rule spans all ports or all protocols. A rule with protocol -1, or a wide port range, admits everything the host is running.',
      matters:
        'Restricting the source and then opening every port means anything else listening on that host is reachable too, including things nobody meant to expose and nobody is patching.',
      run: (b) =>
        ingressRules(b).every((r) => {
          const proto = stringAttr(r, 'ip_protocol') ?? stringAttr(r, 'protocol') ?? '';
          if (proto === '-1' || proto.toLowerCase() === 'all') return false;
          const from = numberAttr(r, 'from_port');
          const to = numberAttr(r, 'to_port');
          return !(from !== null && to !== null && to - from > 1024);
        }),
    },
    {
      id: 'egress_is_bounded',
      requirement: 'Outbound traffic is limited too',
      missing:
        'No egress rule was written, or one of them allows 0.0.0.0/0. Left unspecified in the console, a group allows all outbound by default.',
      matters:
        'Inbound rules decide whether somebody gets in. Outbound rules decide what they can do once they are, and unrestricted egress is how data leaves and how a compromised host reaches whatever it is being told to reach.',
      run: (b) => {
        const rules = egressRules(b);
        return (
          rules.length > 0 &&
          rules.every((r) => !ruleCidrs(r).some((c) => OPEN_TO_THE_WORLD.includes(c)))
        );
      },
    },
  ],
};

/**
 * The third cloud-security task, about the record rather than the defence.
 *
 * Every other security task in the set tries to stop something. This one
 * assumes prevention failed and asks whether anybody could reconstruct what
 * happened. That is a different discipline, and it is the one an incident
 * actually runs on.
 *
 * The rubric is built around what somebody does to the record. Working in a
 * region the trail does not cover leaves no entry at all. Editing delivered
 * objects leaves entries that read normally. Deleting them leaves a gap. Each
 * check closes one of those, and the last is why the title says survives
 * rather than exists.
 */
const AUDIT_TRAIL: GradedTask = {
  id: 'task_audit_trail_v1',
  capabilities: ['auditability', 'durability_and_recovery'],
  track: 'cloud_security',
  title: 'Keep a record of who did what that survives somebody trying to erase it',
  timeboxMinutes: 35,
  brief: (p) => [
    'Nobody can currently say who changed what in this account, or when.',
    'Name the trail ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Assume whoever you are recording knows they are being recorded.',
    'They can work in any region, and they can reach the place the records are kept.',
    'A record that can be quietly edited or removed is worth less than no record, because it will be believed.',
    'Paste the Terraform below. Assume a KMS key exists. Write the log bucket yourself.',
  ],
  identity: {
    requirement: 'The trail is named as the brief specifies',
    missing:
      'The trail name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_cloudtrail').some((t) =>
        (stringAttr(t, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'trail_exists',
      requirement: 'A trail writing to a bucket',
      missing: 'No aws_cloudtrail with an s3_bucket_name was found.',
      matters:
        'The trail is the thing being asked for, and without a destination it records nowhere.',
      run: (b) =>
        findResources(b, 'aws_cloudtrail').some(
          (t) => t.attributes['s3_bucket_name'] !== undefined,
        ),
    },
    {
      id: 'covers_every_region',
      requirement: 'The trail covers all regions',
      missing: 'is_multi_region_trail is absent or false, so the trail records one region only.',
      matters:
        'A single-region trail is the easiest gap to walk through, and it needs no privileges at all. Work in a region nobody watches and the actions leave no entry to find later, rather than a suspicious one.',
      run: (b) =>
        findResources(b, 'aws_cloudtrail').some(
          (t) => boolAttr(t, 'is_multi_region_trail') === true,
        ),
    },
    {
      id: 'logs_are_tamper_evident',
      requirement: 'Log file integrity validation is on',
      missing: 'enable_log_file_validation is absent or false.',
      matters:
        'Without it, a modified log file is indistinguishable from a real one. Validation does not prevent an edit, it makes the edit provable, which is the difference between a record and a story.',
      run: (b) =>
        findResources(b, 'aws_cloudtrail').some(
          (t) => boolAttr(t, 'enable_log_file_validation') === true,
        ),
    },
    {
      id: 'logs_encrypted_with_your_key',
      requirement: 'Delivered logs are encrypted with a key you name',
      missing: 'No kms_key_id was set on the trail.',
      matters:
        'The trail records the account in detail, including resource names and who touched them. Naming your own key is also what lets you deny decryption separately from bucket access.',
      run: (b) =>
        findResources(b, 'aws_cloudtrail').some((t) => t.attributes['kms_key_id'] !== undefined),
    },
    {
      id: 'records_cannot_be_quietly_removed',
      requirement: 'The log bucket keeps versions or locks objects',
      missing:
        'The log bucket has no versioning and no object lock. Nothing stops a delivered log being deleted or replaced.',
      matters:
        'This is the check the title turns on. Every other check protects the record while it is being written. This one protects it afterwards, when somebody with bucket access decides the simplest fix is for the evidence not to be there.',
      run: (b) =>
        findResources(b, 'aws_s3_bucket_versioning').length > 0 ||
        findResources(b, 'aws_s3_bucket_object_lock_configuration').length > 0 ||
        /object_lock_enabled/i.test(rawText(b)),
    },
  ],
};

/**
 * The fourth cloud-security task, and the only one in the set with a trap
 * rather than an omission at its centre.
 *
 * Every other rubric here asks whether something is missing. This one also
 * asks whether something is present that should never have been: a credential
 * typed into the configuration. That submission looks complete, plans
 * cleanly, and works. It also puts the secret into version control
 * permanently, where rotating the credential later does not remove it and
 * everybody with repository access can read it.
 *
 * Graded by value kind rather than by pattern matching. A literal string in
 * secret_string is a hardcoded credential. A reference, or a jsonencode of
 * references, is not. Trying to recognise secrets by how they look would fail
 * both ways, passing an unusual credential and failing a harmless placeholder.
 */
const SECRET_HANDLING: GradedTask = {
  id: 'task_secret_handling_v1',
  capabilities: ['least_privilege_access', 'data_protection'],
  track: 'cloud_security',
  title: 'Store a credential the application can read and a person cannot',
  timeboxMinutes: 35,
  brief: (p) => [
    'An application needs a database password. Today it is set as an environment variable in the deployment configuration, and it has never been changed.',
    'Name the secret ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Give it somewhere to live that the application can read at runtime.',
    'The value itself must not appear anywhere in what you paste.',
    'A password that never changes is one leak away from permanent. Say how it changes.',
    'Paste the Terraform below. Assume a KMS key, an execution role, and a rotation function already exist.',
  ],
  identity: {
    requirement: 'The secret is named as the brief specifies',
    missing:
      'The secret name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_secretsmanager_secret').some((sec) =>
        (stringAttr(sec, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'managed_secret',
      requirement: 'The credential lives in a managed secret',
      missing: 'No aws_secretsmanager_secret was found.',
      matters:
        'An environment variable is readable by anybody who can describe the deployment, and it is recorded wherever that configuration is stored.',
      run: (b) => findResources(b, 'aws_secretsmanager_secret').length > 0,
    },
    {
      id: 'no_credential_in_the_code',
      disqualifying: true,
      remedy:
        'Reference the value instead of writing it, then submit again. If what you pasted is a real credential, change it wherever it is real: it has been written down now, and rotating it is the only thing that undoes that.',
      requirement: 'The value is not written into the configuration',
      missing:
        'A secret_string is set to a literal value. That puts the credential into version control, where rotating it later does not remove it.',
      matters:
        'This is the check the task turns on, and the one a working submission fails. Moving a password into Secrets Manager by typing it into Terraform has not protected it. It has copied it somewhere permanent and added a second place to leak from.',
      run: (b) =>
        findResources(b, 'aws_secretsmanager_secret_version').every((v) => {
          const value = v.attributes['secret_string'] ?? v.attributes['secret_binary'];
          return value === undefined || value.kind !== 'string';
        }),
    },
    {
      id: 'customer_managed_key',
      requirement: 'The secret is encrypted with a key you name',
      missing: 'No kms_key_id was set on the secret.',
      matters:
        'The default key is shared across the account and cannot be given its own policy. Naming your own key is what makes reading the secret a permission you can grant, audit, and take back on its own.',
      run: (b) =>
        findResources(b, 'aws_secretsmanager_secret').some(
          (sec) => sec.attributes['kms_key_id'] !== undefined,
        ),
    },
    {
      id: 'rotation_configured',
      requirement: 'The credential changes on a schedule',
      missing:
        'No aws_secretsmanager_secret_rotation with rotation_rules was found. Nothing in the submission ever changes the password.',
      matters:
        'A credential that never changes turns any single leak into permanent access, and nothing about the leak is visible from the account. Rotation is what puts a bound on how long a stolen password stays worth stealing.',
      run: (b) =>
        findResources(b, 'aws_secretsmanager_secret_rotation').some(
          (r) => findNested(r, 'rotation_rules').length > 0,
        ),
    },
    {
      id: 'read_access_is_scoped',
      requirement: 'Reading it is granted to a named principal',
      missing: 'No policy grants secretsmanager:GetSecretValue, or the grant names no principal.',
      matters:
        'A secret every role in the account can read is an environment variable with extra steps. The point of moving it was to make reading it a decision, and the policy is where that decision is written down.',
      run: (b) => {
        const text = rawText(b);
        return (
          /secretsmanager:GetSecretValue/i.test(text) &&
          (/arn:aws:iam::/i.test(text) || /aws_iam_role\./i.test(text))
        );
      },
    },
  ],
};

/**
 * The second aws_cloud task, about the day after a mistake.
 *
 * The least-privilege task asks whether somebody can stop the wrong person
 * acting. This one asks what happens when the right person acts wrongly, which
 * is the far more common event and the one no permission model prevents.
 * Somebody runs a delete against the wrong environment, or a migration writes
 * over a column, and the entire question becomes whether the data from an hour
 * ago still exists anywhere.
 *
 * Point-in-time recovery is the check that decides it, and it is off by
 * default. A table without it is not visibly deficient. It serves reads, it
 * serves writes, it passes review, and the absence is discovered exactly once,
 * at the worst possible moment, by somebody who cannot do anything about it.
 */
const DURABLE_TABLE: GradedTask = {
  id: 'task_durable_table_v1',
  capabilities: ['durability_and_recovery'],
  track: 'aws_cloud',
  title: 'Build a table that survives somebody deleting the wrong thing',
  timeboxMinutes: 35,
  brief: (p) => [
    'A table will hold customer orders. It is the only copy of them.',
    'Name the table ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Traffic is unpredictable and nobody has a forecast to size it from.',
    'Assume somebody will one day run the wrong command against it, and assume nobody notices for an hour.',
    'Old records stop being useful after a while and should not be paid for forever. Say how they go.',
    'Paste the Terraform below. Assume a KMS key already exists.',
  ],
  identity: {
    requirement: 'The table is named as the brief specifies',
    missing:
      'The table name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_dynamodb_table').some((t) =>
        (stringAttr(t, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'table_with_a_key',
      requirement: 'A table with a hash key and the attribute defined',
      missing: 'No aws_dynamodb_table with a hash_key and a matching attribute block was found.',
      matters:
        'A table needs its key attribute declared as well as named. Terraform will not infer it, and the apply fails on the mismatch rather than on anything meaningful.',
      run: (b) =>
        findResources(b, 'aws_dynamodb_table').some(
          (t) => t.attributes['hash_key'] !== undefined && findNested(t, 'attribute').length > 0,
        ),
    },
    {
      id: 'recoverable',
      requirement: 'Point-in-time recovery is on',
      missing:
        'No point_in_time_recovery block with enabled set true was found. It is off by default.',
      matters:
        'This is the check the task turns on, and the only one here that cannot be fixed after the fact. Without it there is no version of this table from before the mistake, and the data is simply gone. Every other property can be turned on tomorrow.',
      run: (b) =>
        findResources(b, 'aws_dynamodb_table').some((t) =>
          findNested(t, 'point_in_time_recovery').some((r) => boolAttr(r, 'enabled') === true),
        ),
    },
    {
      id: 'sized_for_unknown_traffic',
      requirement: 'Billing does not require a forecast nobody has',
      missing: 'billing_mode is not PAY_PER_REQUEST.',
      matters:
        'Provisioned capacity without a forecast is a guess with two failure modes: too low throttles real customers, too high bills for capacity nobody used. On-demand removes the guess, and it is the honest answer when the brief says the traffic is unknown.',
      run: (b) =>
        findResources(b, 'aws_dynamodb_table').some(
          (t) => (stringAttr(t, 'billing_mode') ?? '').toUpperCase() === 'PAY_PER_REQUEST',
        ),
    },
    {
      id: 'old_records_expire',
      requirement: 'Records expire on their own',
      missing: 'No ttl block with enabled and an attribute_name was found.',
      matters:
        'Without expiry the table grows for as long as the product exists, and the cost of it is paid every month for records nobody reads. A deletion job written later is a second thing to run, monitor, and get wrong.',
      run: (b) =>
        findResources(b, 'aws_dynamodb_table').some((t) =>
          findNested(t, 'ttl').some(
            (r) => boolAttr(r, 'enabled') === true && r.attributes['attribute_name'] !== undefined,
          ),
        ),
    },
    {
      id: 'hard_to_delete_by_accident',
      requirement: 'The table itself is protected from deletion',
      missing: 'deletion_protection_enabled is absent or false.',
      matters:
        'Recovery restores the contents of a table. It does not help if the table is gone, and a destroy against the wrong workspace removes it in one step with nothing to confirm. This is the guard that makes that step fail instead.',
      run: (b) =>
        findResources(b, 'aws_dynamodb_table').some(
          (t) => boolAttr(t, 'deletion_protection_enabled') === true,
        ),
    },
  ],
};

/**
 * The third aws_cloud task, about serving files to the public without the
 * bucket being public.
 *
 * Almost everybody gets a site online. The separating question is what the
 * bucket looks like afterwards. The quickest route is to make it public and
 * point a distribution at it, which works, and leaves an origin anybody can
 * read directly, bypassing every control the distribution carries.
 *
 * Origin access control is graded rather than origin access identity on
 * purpose. Both keep the bucket private, and the older one is what most
 * tutorials still show, but AWS marks it legacy and it cannot sign requests
 * to newer regions or to buckets using KMS. Recognising the current one is a
 * fair proxy for whether somebody has done this recently or is repeating
 * something they read.
 */
const PRIVATE_ORIGIN: GradedTask = {
  id: 'task_private_origin_v1',
  capabilities: ['network_isolation'],
  track: 'aws_cloud',
  title: 'Serve a site to the public from a bucket that is not public',
  timeboxMinutes: 35,
  brief: (p) => [
    'A static site needs to be online and fast for people anywhere.',
    'Name the distribution comment ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'The files live in one bucket, and that bucket must not be readable except through the distribution.',
    'Nobody should be able to reach the site, or the files behind it, without encryption.',
    'Paste the Terraform below. Assume the bucket and its contents already exist.',
  ],
  identity: {
    requirement: 'The distribution comment is as the brief specifies',
    missing:
      'The distribution comment in this submission is not the one your brief asked for. Use the value in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_cloudfront_distribution').some((d) =>
        (stringAttr(d, 'comment') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'distribution',
      requirement: 'A distribution with an origin and a default behaviour',
      missing:
        'No aws_cloudfront_distribution with both an origin and a default_cache_behavior was found.',
      matters:
        'A distribution needs somewhere to fetch from and a rule for what to do with a request. Neither is optional and neither is inferred.',
      run: (b) =>
        findResources(b, 'aws_cloudfront_distribution').some(
          (d) =>
            findNested(d, 'origin').length > 0 &&
            findNested(d, 'default_cache_behavior').length > 0,
        ),
    },
    {
      id: 'origin_access_control',
      requirement: 'The origin is reached through origin access control',
      missing:
        'No aws_cloudfront_origin_access_control was found, or no origin references one through origin_access_control_id.',
      matters:
        'This is the check the task turns on. Without it the bucket has to be public for the distribution to read it, which leaves an address anybody can fetch from directly, skipping the distribution and every header, restriction and log it carries.',
      run: (b) =>
        findResources(b, 'aws_cloudfront_origin_access_control').length > 0 &&
        findResources(b, 'aws_cloudfront_distribution').some((d) =>
          findNested(d, 'origin').some(
            (o) => o.attributes['origin_access_control_id'] !== undefined,
          ),
        ),
    },
    {
      id: 'bucket_stays_private',
      requirement: 'The bucket blocks public access',
      missing: 'No aws_s3_bucket_public_access_block was found for the origin bucket.',
      matters:
        'Origin access control lets the bucket stay private. It does not make it private. Without the block, a bucket that was public before this change is still public after it, and the control is protecting an open door.',
      run: (b) => findResources(b, 'aws_s3_bucket_public_access_block').length > 0,
    },
    {
      id: 'https_only',
      requirement: 'Viewers are not served over plain HTTP',
      missing:
        'viewer_protocol_policy is absent or set to allow-all, so a request over HTTP is answered rather than redirected.',
      matters:
        'allow-all means the site works over HTTP and nothing says so. Anything a visitor sends on that first request, including whatever is in the URL, travels in the clear and can be changed in transit.',
      run: (b) =>
        findResources(b, 'aws_cloudfront_distribution').some((d) =>
          findNested(d, 'default_cache_behavior').some((c) => {
            const policy = (stringAttr(c, 'viewer_protocol_policy') ?? '').toLowerCase();
            return policy === 'redirect-to-https' || policy === 'https-only';
          }),
        ),
    },
    {
      id: 'modern_tls',
      requirement: 'The certificate settings do not permit obsolete TLS',
      missing: 'No minimum_protocol_version of TLSv1.2 or better was found in viewer_certificate.',
      matters:
        'Redirecting to HTTPS decides that the connection is encrypted. This decides whether the encryption is worth anything, and the older versions this excludes are ones with published attacks against them.',
      run: (b) =>
        findResources(b, 'aws_cloudfront_distribution').some((d) =>
          findNested(d, 'viewer_certificate').some((v) =>
            /TLSv1\.[23]/i.test(stringAttr(v, 'minimum_protocol_version') ?? ''),
          ),
        ),
    },
  ],
};

/**
 * The fourth aws_cloud task, about work that is handed over rather than done
 * in front of the caller.
 *
 * A queue is the first thing anybody reaches for to decouple two services, and
 * it is also the first place work disappears silently. A message that fails
 * often enough is deleted by SQS itself once it exhausts its receives, and
 * nothing anywhere records that it existed. The service looks healthy. The
 * queue is empty. The work is gone.
 *
 * The dead-letter queue is what turns that into something findable, and it is
 * graded together with the visibility timeout because they fail as a pair. A
 * timeout shorter than the handler takes redelivers messages that are still
 * being processed, and the retries count toward the same limit, so a queue
 * with a dead-letter queue and a short timeout discards work that never
 * actually failed.
 */
const RELIABLE_QUEUE: GradedTask = {
  id: 'task_reliable_queue_v1',
  capabilities: ['failure_handling'],
  track: 'aws_cloud',
  title: 'Hand work to a queue without it quietly disappearing',
  timeboxMinutes: 35,
  brief: (p) => [
    'One service hands work to another through a queue. Each item takes up to thirty seconds to process.',
    'Name the queue ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Some items will fail. A few will fail every time they are tried.',
    'An item nobody can process must end up somewhere a person can look at it, not be dropped.',
    'The items describe customer records, so what sits in the queue is not public.',
    'Paste the Terraform below. Assume the two services already exist.',
  ],
  identity: {
    requirement: 'The queue is named as the brief specifies',
    missing:
      'The queue name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sqs_queue').some((q) =>
        (stringAttr(q, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'two_queues',
      requirement: 'A working queue and a separate one for failures',
      missing: 'Fewer than two aws_sqs_queue resources were found.',
      matters:
        'The failure queue has to be its own queue. Somewhere for bad messages to go is the whole mechanism, and it cannot be the queue they are already failing on.',
      run: (b) => findResources(b, 'aws_sqs_queue').length >= 2,
    },
    {
      id: 'failures_are_kept',
      requirement: 'A redrive policy sends exhausted messages to the failure queue',
      missing: 'No redrive_policy with a deadLetterTargetArn and a maxReceiveCount was found.',
      matters:
        'This is the check the task turns on. Without a redrive policy SQS deletes a message once it has been received too many times, and nothing records that it ever arrived. The service reports healthy, the queue reads empty, and the work is gone with no trace to investigate.',
      run: (b) => {
        const text = rawText(findResources(b, 'aws_sqs_queue'));
        return /deadLetterTargetArn/i.test(text) && /maxReceiveCount/i.test(text);
      },
    },
    {
      id: 'timeout_covers_the_work',
      requirement: 'The visibility timeout is at least as long as the work takes',
      missing:
        'visibility_timeout_seconds is absent or under thirty seconds, which is how long the brief says an item takes.',
      matters:
        'A timeout shorter than the handler hands the same message to a second consumer while the first is still working. The duplicate deliveries count toward the retry limit, so the message reaches the failure queue having never actually failed, and the work is done twice on the way.',
      run: (b) =>
        findResources(b, 'aws_sqs_queue').some((q) => {
          const v = q.attributes['visibility_timeout_seconds'];
          return v !== undefined && v.kind === 'number' && v.value >= 30;
        }),
    },
    {
      id: 'contents_encrypted',
      requirement: 'Messages are encrypted at rest',
      missing: 'Neither sqs_managed_sse_enabled nor kms_master_key_id was set on the queue.',
      matters:
        'The messages describe customer records, and a queue holds them for as long as its retention allows. Encryption at rest is the difference between that being storage of personal data and storage of personal data nobody decided about.',
      run: (b) =>
        findResources(b, 'aws_sqs_queue').some(
          (q) =>
            boolAttr(q, 'sqs_managed_sse_enabled') === true ||
            q.attributes['kms_master_key_id'] !== undefined,
        ),
    },
    {
      id: 'failures_survive_the_weekend',
      requirement: 'A queue keeps messages longer than the four-day default',
      missing:
        'No message_retention_seconds longer than the four-day default was set on any queue.',
      matters:
        'A dead-letter queue is only useful for as long as somebody has to notice it. On the default retention, anything that fails on a Friday is deleted before the following week is out, which turns the queue that exists to preserve evidence into one that quietly expires it.',
      run: (b) =>
        // Graded as longer than the default rather than as belonging to the
        // dead-letter queue specifically. Which queue is which is only
        // knowable by following the redrive policy, and a candidate who
        // extends retention on both has answered what the brief asks.
        findResources(b, 'aws_sqs_queue').some((q) => {
          const v = q.attributes['message_retention_seconds'];
          return v !== undefined && v.kind === 'number' && v.value > DEFAULT_SQS_RETENTION_SECONDS;
        }),
    },
  ],
};

/**
 * The second devops_platform task, on the credential that should not exist.
 *
 * Nearly every account that has been running a while has a deploy user with a
 * key in a CI secret, created once and never rotated, valid until somebody
 * deletes it. Replacing that with short-lived federated credentials is the
 * single highest-value change most platforms can make, and it is the reason
 * this task exists.
 *
 * The subject condition is graded as disqualifying, which is the second use of
 * that mechanism and was not decided lightly. The reasoning is in
 * docs/DECISIONS.md and is specific: a trust policy that federates GitHub
 * without naming a repository can be assumed by anybody who can create a
 * repository on GitHub, which is everybody. That is not a partially completed
 * task. It is strictly worse than the long-lived key it replaces, because a
 * key sitting in a CI secret is at least not publicly assumable. Letting the
 * allowed miss absorb it would put a Zoryvex verification on a submission that
 * hands the account to the internet.
 *
 * Omitting the condition and writing it as a wildcard are graded the same way
 * on purpose. They produce an identical trust policy, and treating one more
 * gently than the other would grade the typing rather than the outcome.
 */
const KEYLESS_DEPLOY: GradedTask = {
  id: 'task_keyless_deploy_v1',
  capabilities: ['least_privilege_access'],
  track: 'devops_platform',
  title: 'Let CI deploy without a key that never expires',
  timeboxMinutes: 40,
  brief: (p) => [
    'A GitHub Actions workflow deploys this account. Today it authenticates with an access key stored as a repository secret, created two years ago.',
    'Name the role ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Replace the key with credentials that are issued per run and expire on their own.',
    'The repository is acme/platform. Nothing else should be able to assume the role, and be specific about that: the trust policy is the whole security boundary here.',
    'Paste the Terraform below. Assume the permissions policy for the role already exists.',
  ],
  identity: {
    requirement: 'The role is named as the brief specifies',
    missing:
      'The role name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_iam_role').some((r) => (stringAttr(r, 'name') ?? '').includes(p.token)),
  },
  passMark: 0,
  checks: [
    {
      id: 'identity_provider',
      requirement: 'An OIDC provider for the token issuer',
      missing: 'No aws_iam_openid_connect_provider with a url was found.',
      matters:
        'The provider is what makes the account willing to consider a GitHub token at all. Without it there is nothing for a trust policy to federate against.',
      run: (b) =>
        findResources(b, 'aws_iam_openid_connect_provider').some(
          (o) => o.attributes['url'] !== undefined,
        ),
    },
    {
      id: 'web_identity_trust',
      requirement: 'The role is assumed with a web identity token',
      missing:
        'No trust policy uses sts:AssumeRoleWithWebIdentity. A role trusting a service or an account is not federating anything.',
      matters:
        'This is the action that exchanges a token the workflow already has for credentials that expire by themselves. It is what removes the need for anything stored.',
      run: (b) => /sts:AssumeRoleWithWebIdentity/i.test(rawText(b)),
    },
    {
      id: 'scoped_to_the_repository',
      disqualifying: true,
      remedy:
        'Add a subject condition naming the repository from your brief, then submit again. If a role like this one is already applied anywhere, narrow it before anything else: while it is open, it is assumable by anybody.',
      requirement: 'The trust policy names the repository allowed to assume it',
      missing:
        'The trust policy has no subject condition naming a repository, or the one it has is a wildcard. As written, any GitHub repository can assume this role.',
      matters:
        'This is the check the task turns on, and failing it is worse than changing nothing. Federating GitHub without naming a repository means anybody who can create one, which is everybody, can assume a role that deploys to this account. The access key you were replacing at least could not be used by a stranger.',
      run: (b) => {
        const text = rawText(b);
        if (!/:sub/i.test(text)) return false;
        // A subject that is only a wildcard, or whose repository portion is,
        // matches every repository on GitHub.
        if (/"[^"]*:sub"\s*[=:]\s*"?\*/i.test(text)) return false;
        if (/repo:\*/i.test(text)) return false;
        return /repo:[A-Za-z0-9._-]+\//i.test(text);
      },
    },
    {
      id: 'audience_checked',
      requirement: 'The audience claim is checked too',
      missing: 'No aud condition was found in the trust policy.',
      matters:
        'The subject says which repository asked. The audience says the token was minted for this account rather than for some other service the workflow also talks to, and checking only one of the two leaves a token issued elsewhere usable here.',
      run: (b) => /:aud/i.test(rawText(b)),
    },
    {
      id: 'no_long_lived_key',
      requirement: 'No access key is created alongside it',
      missing:
        'An aws_iam_access_key or aws_iam_user was found. The submission adds federation without removing the thing it replaces.',
      matters:
        'A federated role beside a working access key has changed nothing an attacker cares about. The old credential is still valid, still in the CI secret, and still the easiest way in.',
      run: (b) =>
        findResources(b, 'aws_iam_access_key').length === 0 &&
        findResources(b, 'aws_iam_user').length === 0,
    },
  ],
};

/**
 * The third devops_platform task, on the alarm that does not fire.
 *
 * Alarms are usually written against a metric going wrong: errors above a
 * threshold, latency above a number. Almost nobody writes them for the metric
 * stopping, and that is the case that matters most, because a service that has
 * died entirely reports no errors at all.
 *
 * CloudWatch treats missing data as missing by default, which means an alarm
 * on an error count sits quietly in INSUFFICIENT_DATA through a total outage.
 * The dashboard is green. The alarm never fired. Somebody finds out from a
 * customer. That default is the whole subject of this task.
 */
const ALARM_THAT_FIRES: GradedTask = {
  id: 'task_alarm_that_fires_v1',
  capabilities: ['observability_and_alerting'],
  track: 'devops_platform',
  title: 'Raise an alarm that still fires when the thing stops completely',
  timeboxMinutes: 35,
  brief: (p) => [
    'An API publishes a count of failed requests every minute. Nobody is watching it.',
    'Name the alarm ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Raise an alarm when failures climb, and make sure it reaches a person rather than a dashboard.',
    'The hardest case is not the API failing. It is the API stopping, and publishing nothing at all. Handle that one.',
    'A single bad minute is a blip. Do not wake somebody for it.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The alarm is named as the brief specifies',
    missing:
      'The alarm name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_cloudwatch_metric_alarm').some((a) =>
        (stringAttr(a, 'alarm_name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'alarm_on_a_metric',
      requirement: 'An alarm naming a metric and a namespace',
      missing: 'No aws_cloudwatch_metric_alarm with a metric_name and a namespace was found.',
      matters:
        'An alarm has to say what it is watching. Neither half is inferred, and a metric name without its namespace does not identify anything.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_metric_alarm').some(
          (a) =>
            a.attributes['metric_name'] !== undefined && a.attributes['namespace'] !== undefined,
        ),
    },
    {
      id: 'somebody_is_told',
      requirement: 'The alarm has an action',
      missing: 'No alarm_actions were set.',
      matters:
        'An alarm with no action changes a colour on a page nobody has open. The brief asks for it to reach a person, and the action is the only part that does that.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_metric_alarm').some(
          (a) => a.attributes['alarm_actions'] !== undefined,
        ),
    },
    {
      id: 'silence_counts_as_failure',
      requirement: 'Missing data is treated as breaching',
      missing:
        'treat_missing_data is absent or not breaching. The default is missing, which is why this needs saying explicitly.',
      matters:
        'This is the check the task turns on. An alarm on failed requests sees nothing at all when the API is completely down, and on the default it sits in INSUFFICIENT_DATA rather than alarming. The worst outage produces the quietest monitoring, and the first report comes from a customer.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_metric_alarm').some(
          (a) => (stringAttr(a, 'treat_missing_data') ?? '').toLowerCase() === 'breaching',
        ),
    },
    {
      id: 'someone_receives_it',
      requirement: 'The topic has a subscriber',
      missing: 'No aws_sns_topic_subscription was found.',
      matters:
        'A topic with no subscription accepts the message and delivers it nowhere. It is the same silence as having no alarm, arrived at through more configuration.',
      run: (b) => findResources(b, 'aws_sns_topic_subscription').length > 0,
    },
    {
      id: 'not_one_stray_minute',
      requirement: 'It takes more than a single bad datapoint',
      missing:
        'evaluation_periods is 1 and no datapoints_to_alarm was set, so one bad minute pages somebody.',
      matters:
        'An alarm that fires on every blip gets muted, and a muted alarm is worse than none because everybody believes it is still working. Requiring more than one datapoint is what keeps it credible enough to be acted on.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_metric_alarm').some((a) => {
          const datapoints = a.attributes['datapoints_to_alarm'];
          if (datapoints !== undefined && datapoints.kind === 'number' && datapoints.value > 1) {
            return true;
          }
          const periods = a.attributes['evaluation_periods'];
          return periods !== undefined && periods.kind === 'number' && periods.value > 1;
        }),
    },
  ],
};

/**
 * The fourth devops_platform task, on the tag that changed underneath you.
 *
 * A registry looks like storage and behaves like a contract. Everything
 * downstream, every deployment, every rollback, every incident
 * reconstruction, rests on a tag meaning the same bytes tomorrow as it does
 * today, and by default it does not: pushing again over the same tag silently
 * replaces it.
 *
 * That default is why an image built from a known commit can stop matching
 * the commit, why a rollback to the previous tag can redeploy the thing being
 * rolled back from, and why a supply-chain compromise leaves no trace in the
 * deployment history. Immutability is one word of configuration and is the
 * whole difference.
 */
const IMAGE_SUPPLY_CHAIN: GradedTask = {
  id: 'task_image_supply_chain_v1',
  capabilities: ['supply_chain_integrity'],
  track: 'devops_platform',
  title: 'Publish images that cannot be swapped underneath you',
  timeboxMinutes: 35,
  brief: (p) => [
    'Every service here is deployed from a container image, and the pipeline pushes to one registry.',
    'Name the repository ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'A tag deployed on Monday must be the same bytes when it is redeployed on Friday.',
    'Somebody should learn about a known vulnerability in an image from the registry, not from an audit.',
    'The pipeline pushes on every merge and nothing ever removes anything.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The repository is named as the brief specifies',
    missing:
      'The repository name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_ecr_repository').some((r) =>
        (stringAttr(r, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'repository',
      requirement: 'A container repository',
      missing: 'No aws_ecr_repository was found.',
      matters: 'The registry is the thing being asked for.',
      run: (b) => findResources(b, 'aws_ecr_repository').length > 0,
    },
    {
      id: 'tags_are_immutable',
      requirement: 'Tags cannot be overwritten',
      missing: 'image_tag_mutability is absent or MUTABLE, which is the default.',
      matters:
        'This is the check the task turns on. On the default, pushing again over a tag replaces it and nothing records that it changed. The image you tested is not necessarily the image you deployed, a rollback to the previous tag can redeploy exactly what you are rolling back from, and a replaced image leaves the deployment history reading normally.',
      run: (b) =>
        findResources(b, 'aws_ecr_repository').some((r) =>
          (stringAttr(r, 'image_tag_mutability') ?? '').toUpperCase().startsWith('IMMUTABLE'),
        ),
    },
    {
      id: 'scanned_on_push',
      requirement: 'Images are scanned as they arrive',
      missing: 'No image_scanning_configuration with scan_on_push set true was found.',
      matters:
        'Scanning at push is the only point where the result reaches the person who caused it, while they still have the context to fix it. A scan run later reaches somebody reading a report about work they did not do.',
      run: (b) =>
        findResources(b, 'aws_ecr_repository').some((r) =>
          findNested(r, 'image_scanning_configuration').some(
            (c) => boolAttr(c, 'scan_on_push') === true,
          ),
        ),
    },
    {
      id: 'old_images_expire',
      requirement: 'Something removes images nobody uses',
      missing: 'No aws_ecr_lifecycle_policy was found.',
      matters:
        'A push on every merge and nothing removing anything is a bill that only grows, and most of it is untagged layers from builds that were superseded the same afternoon.',
      run: (b) => findResources(b, 'aws_ecr_lifecycle_policy').length > 0,
    },
    {
      id: 'encrypted_at_rest',
      requirement: 'The repository is encrypted',
      missing: 'No encryption_configuration was found.',
      matters:
        'Images carry application code, and often enough the configuration and dependency set that describe how it is deployed. Saying which key protects them is the difference between a decision and a default.',
      run: (b) =>
        findResources(b, 'aws_ecr_repository').some(
          (r) => findNested(r, 'encryption_configuration').length > 0,
        ),
    },
  ],
};

/**
 * The fifth aws_cloud task, on work made of steps that can each fail.
 *
 * The queue task covers work handed over once. This covers work with an order
 * to it, where step three calls a payment provider and step four writes the
 * result, and the interesting question is what the whole thing does when step
 * three times out.
 *
 * Written against the wrong instinct rather than a missing feature. A state
 * machine with no retry and no catch is valid, deploys, and passes a demo,
 * because in a demo nothing times out. In production a transient failure
 * anywhere kills the entire execution, and because the earlier steps already
 * ran, the work is left half done with no record saying which half.
 */
const RESILIENT_WORKFLOW: GradedTask = {
  id: 'task_resilient_workflow_v1',
  capabilities: ['failure_handling'],
  track: 'aws_cloud',
  title: 'Run a multi-step job that survives one step failing',
  timeboxMinutes: 40,
  brief: (p) => [
    'An order is processed in several steps. One of them calls a payment provider that is occasionally slow and occasionally down.',
    'Name the state machine ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'A step that fails because the provider was briefly unavailable should not lose the whole order.',
    'A step that fails because the payment was declined is a different thing, and something has to handle it rather than the execution simply ending.',
    'When one does go wrong at three in the morning, somebody has to be able to see where.',
    'Paste the Terraform below. Assume the functions each step calls, and an execution role, already exist.',
  ],
  identity: {
    requirement: 'The state machine is named as the brief specifies',
    missing:
      'The state machine name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sfn_state_machine').some((m) =>
        (stringAttr(m, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'state_machine',
      requirement: 'A state machine with a definition and a role',
      missing: 'No aws_sfn_state_machine with a definition and a role_arn was found.',
      matters:
        'The steps and the identity they run as are both required. A definition without a role has nothing to execute with.',
      run: (b) =>
        findResources(b, 'aws_sfn_state_machine').some(
          (m) => m.attributes['definition'] !== undefined && m.attributes['role_arn'] !== undefined,
        ),
    },
    {
      id: 'transient_failures_retry',
      requirement: 'Steps retry when the failure was temporary',
      missing: 'No Retry was found in the definition.',
      matters:
        'This is the check the task turns on. Without a retry, a provider that was unavailable for two seconds ends the execution, and because the earlier steps already ran the order is left half processed with nothing recording which half.',
      run: (b) => /"?Retry"?\s*[=:]/i.test(rawText(b)),
    },
    {
      id: 'retries_back_off',
      requirement: 'The retry waits longer each time',
      missing: 'No BackoffRate or IntervalSeconds was found on a Retry.',
      matters:
        'Retrying immediately, at the same rate, is how a struggling dependency is turned into a failed one. Every caller retries together and the retries arrive as a burst exactly when the thing has least capacity to answer them.',
      run: (b) => /BackoffRate|IntervalSeconds/i.test(rawText(b)),
    },
    {
      id: 'permanent_failures_caught',
      requirement: 'A failure that will not succeed on retry is handled',
      missing: 'No Catch was found in the definition.',
      matters:
        'A declined payment fails identically every time it is tried. Retry gets through its attempts and the execution ends in failure, which is a state nothing downstream is watching. Catch routes it somewhere that can record it and tell somebody.',
      run: (b) => /"?Catch"?\s*[=:]/i.test(rawText(b)),
    },
    {
      id: 'failures_are_visible',
      requirement: 'Execution history is logged',
      missing: 'No logging_configuration with a log_destination was found.',
      matters:
        'At three in the morning the question is which step failed and with what. Without logging the console shows an execution that failed and the reason lives only in whatever the failing step happened to write for itself.',
      run: (b) =>
        findResources(b, 'aws_sfn_state_machine').some((m) =>
          findNested(m, 'logging_configuration').some(
            (c) => c.attributes['log_destination'] !== undefined,
          ),
        ),
    },
  ],
};

/**
 * The sixth aws_cloud task, on the endpoint anybody can call.
 *
 * A public HTTP API is the one resource where somebody else decides how much
 * of it you use. Every other cost in these tasks is a consequence of a choice
 * the account made; this one is a consequence of who finds the URL.
 *
 * Both graded properties are absent by default and neither absence is
 * visible. An API with no authorizer serves whoever asks. An API with no
 * throttle serves them as fast as they can ask, and on a per-request billing
 * model that is somebody else spending your money at their chosen rate. The
 * first bill is the notification.
 */
const BOUNDED_API: GradedTask = {
  id: 'task_bounded_api_v1',
  capabilities: ['cost_control'],
  track: 'aws_cloud',
  title: 'Expose an API without handing over your bill',
  timeboxMinutes: 35,
  brief: (p) => [
    'An HTTP API needs to be reachable from a browser application. It is billed per request and it calls a function that reads from a database.',
    'Name the API ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Only signed-in users of the application should get answers from it.',
    'Assume somebody eventually points a script at it. Decide in advance how much of it they get.',
    'When that happens, you should be able to see it in the record rather than infer it from an invoice.',
    'Paste the Terraform below. Assume the function and a token issuer already exist.',
  ],
  identity: {
    requirement: 'The API is named as the brief specifies',
    missing:
      'The API name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_apigatewayv2_api').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'api_and_stage',
      requirement: 'An API with a stage',
      missing: 'No aws_apigatewayv2_api with an aws_apigatewayv2_stage was found.',
      matters:
        'The API describes the routes and the stage is what is actually deployed and addressable. Without a stage there is nothing to call.',
      run: (b) =>
        findResources(b, 'aws_apigatewayv2_api').length > 0 &&
        findResources(b, 'aws_apigatewayv2_stage').length > 0,
    },
    {
      id: 'requests_are_authorized',
      requirement: 'Routes are behind an authorizer',
      missing:
        'No aws_apigatewayv2_authorizer was found, or no route references one through authorizer_id.',
      matters:
        'An API with no authorizer answers whoever asks, and nothing about that looks wrong until somebody notices the data is public. Declaring one and never attaching it to a route is the same as not having one.',
      run: (b) =>
        findResources(b, 'aws_apigatewayv2_authorizer').length > 0 &&
        findResources(b, 'aws_apigatewayv2_route').some(
          (r) => r.attributes['authorizer_id'] !== undefined,
        ),
    },
    {
      id: 'throughput_is_capped',
      requirement: 'The stage limits how fast it can be called',
      missing:
        'No default_route_settings with a throttling_rate_limit or throttling_burst_limit was found.',
      matters:
        'This is the check the task turns on, and it is the one that turns a security incident into an invoice. Per-request billing with no ceiling means a script deciding your spend, and the account limit is shared, so the same script takes down every other API in the account with it.',
      run: (b) =>
        findResources(b, 'aws_apigatewayv2_stage').some((st) =>
          findNested(st, 'default_route_settings').some(
            (rs) =>
              rs.attributes['throttling_rate_limit'] !== undefined ||
              rs.attributes['throttling_burst_limit'] !== undefined,
          ),
        ),
    },
    {
      id: 'calls_are_recorded',
      requirement: 'Access logging is on',
      missing: 'No access_log_settings with a destination_arn was found on the stage.',
      matters:
        'Without access logs the first evidence of abuse is a bill, and there is no way to tell afterwards who called, how often, or from where. The brief asks for the record rather than the inference.',
      run: (b) =>
        findResources(b, 'aws_apigatewayv2_stage').some((st) =>
          findNested(st, 'access_log_settings').some(
            (l) => l.attributes['destination_arn'] !== undefined,
          ),
        ),
    },
    {
      id: 'browser_origins_are_named',
      requirement: 'CORS names the origins allowed, rather than all of them',
      missing:
        'No cors_configuration was found, or allow_origins is a wildcard. The brief says a browser application calls this.',
      matters:
        'A wildcard origin lets any page on the internet make calls from a visitor browser. It is the setting people reach for to make a local page work and then leave, and it quietly widens who can drive an authenticated session.',
      run: (b) =>
        findResources(b, 'aws_apigatewayv2_api').some((a) =>
          findNested(a, 'cors_configuration').some((c) => {
            const origins = c.attributes['allow_origins'];
            if (origins === undefined) return false;
            if (origins.kind !== 'list') return true;
            return !origins.items.some((i) => i.kind === 'string' && i.value === '*');
          }),
        ),
    },
  ],
};

/**
 * The seventh aws_cloud task, and the only one where the deliverable is a
 * warning rather than a control.
 *
 * Several tasks here reduce spend: a table that expires records, a workbench
 * that shuts itself down, a registry that prunes. All of them assume the cost
 * is one you predicted. None of them covers the case where something you did
 * not predict starts spending, which is what actually happens, and where the
 * only defence is finding out early.
 *
 * The graded distinction is between a budget that reports and a budget that
 * warns. Alerting on actual spend at a hundred percent is a message telling
 * you the money is already gone. The useful version fires on the forecast,
 * below the limit, while there is still a month left to do something.
 */
const COST_ALARM: GradedTask = {
  id: 'task_cost_alarm_v1',
  capabilities: ['cost_control', 'observability_and_alerting'],
  track: 'aws_cloud',
  title: 'Find out about a runaway bill before the month ends',
  timeboxMinutes: 30,
  brief: (p) => [
    'This account has a monthly spend nobody watches, and last month it doubled without anybody noticing until the invoice.',
    'Name the budget ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Set what the account is expected to cost each month.',
    'A message saying the money has been spent is not useful. The point is to hear about it while the month is still running and something can be done.',
    'It has to reach a person.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The budget is named as the brief specifies',
    missing:
      'The budget name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_budgets_budget').some((bu) =>
        (stringAttr(bu, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'monthly_budget',
      requirement: 'A monthly cost budget with an amount',
      missing: 'No aws_budgets_budget with a limit_amount and a monthly time_unit was found.',
      matters:
        'A budget without an amount has nothing to compare against, and one measured over a period other than the month does not line up with how the account is billed.',
      run: (b) =>
        findResources(b, 'aws_budgets_budget').some(
          (bu) =>
            bu.attributes['limit_amount'] !== undefined &&
            (stringAttr(bu, 'time_unit') ?? '').toUpperCase() === 'MONTHLY',
        ),
    },
    {
      id: 'somebody_is_notified',
      requirement: 'A notification with a subscriber',
      missing:
        'No notification block with subscriber_email_addresses or subscriber_sns_topic_arns was found.',
      matters:
        'A budget with no notification is a number on a page in a console nobody opens. The subscriber is the only part that makes it reach anybody.',
      run: (b) =>
        findResources(b, 'aws_budgets_budget').some((bu) =>
          findNested(bu, 'notification').some(
            (n) =>
              n.attributes['subscriber_email_addresses'] !== undefined ||
              n.attributes['subscriber_sns_topic_arns'] !== undefined,
          ),
        ),
    },
    {
      id: 'warns_on_the_forecast',
      requirement: 'At least one notification fires on the forecast',
      missing: 'No notification with notification_type set to FORECASTED was found.',
      matters:
        'This is the check the task turns on. A notification on actual spend arrives after the money is gone, which is a receipt rather than a warning. The forecast is what tells you in week two that the month is heading somewhere bad, while there is still a month left to change it.',
      run: (b) =>
        findResources(b, 'aws_budgets_budget').some((bu) =>
          findNested(bu, 'notification').some(
            (n) => (stringAttr(n, 'notification_type') ?? '').toUpperCase() === 'FORECASTED',
          ),
        ),
    },
    {
      id: 'warns_before_the_limit',
      requirement: 'A notification fires before the budget is reached',
      missing: 'Every notification threshold sits at or above the budget itself.',
      matters:
        'Alerting only at the limit means the first warning arrives at the moment there is nothing left to protect. A threshold below it is what creates the gap between noticing and overspending.',
      run: (b) =>
        findResources(b, 'aws_budgets_budget').some((bu) => {
          // Both spellings of "before the limit" have to count. A percentage
          // under 100 is the expected answer, and an absolute threshold under
          // the budget says the same thing, often earlier. The first version
          // of this check only understood percentages and would have failed a
          // candidate whose answer warned sooner than the one being looked
          // for, which is the worst way for a rubric to be wrong.
          const limit = numericish(bu.attributes['limit_amount']);
          return findNested(bu, 'notification').some((n) => {
            const threshold = n.attributes['threshold'];
            if (threshold === undefined || threshold.kind !== 'number') return false;
            const kind = (stringAttr(n, 'threshold_type') ?? 'PERCENTAGE').toUpperCase();
            if (kind === 'PERCENTAGE') return threshold.value < 100;
            return limit !== null && threshold.value < limit;
          });
        }),
    },
    {
      id: 'triggers_when_exceeded',
      requirement: 'The comparison fires on going over, not under',
      missing: 'No notification with comparison_operator set to GREATER_THAN was found.',
      matters:
        'The operator decides which direction is the bad one, and it is required rather than defaulted. A budget configured to notify on spending less than forecast is a working budget that never fires for the reason it was created.',
      run: (b) =>
        findResources(b, 'aws_budgets_budget').some((bu) =>
          findNested(bu, 'notification').some(
            (n) => (stringAttr(n, 'comparison_operator') ?? '').toUpperCase() === 'GREATER_THAN',
          ),
        ),
    },
  ],
};

/**
 * The fifth devops_platform task, on the backup that was never taken.
 *
 * The durable-table task covers recovering one table from a mistake. This is
 * the wider version of the same question, and it is the one people are most
 * confident about and least often right about, because a backup configuration
 * gives no feedback. Nothing fails when it is wrong. The plan exists, the
 * console shows it, and the first honest test of it is an incident.
 *
 * Two of the checks are about that specific gap between configured and
 * working. A plan with no selection runs on schedule and backs up nothing,
 * which produces a successful job history for an empty set. And a copy to a
 * second vault is what decides whether the backup survives the event that
 * took the original, since a copy sitting in the same account and region as
 * its source is protected against deletion and corruption but not against
 * losing the account or the region.
 */
const RECOVERABLE_ESTATE: GradedTask = {
  id: 'task_recoverable_estate_v1',
  capabilities: ['durability_and_recovery'],
  track: 'devops_platform',
  title: 'Take backups that are still there when you need them',
  timeboxMinutes: 35,
  brief: (p) => [
    'Several databases hold data this business cannot re-create. Nothing currently backs them up on a schedule.',
    'Name the backup plan ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Back them up regularly, without somebody remembering to.',
    'Be explicit about which resources are covered. A plan that runs and protects nothing still reports success.',
    'Assume the worst case is losing the region the data is in, not one bad afternoon.',
    'Backups are not free, so say how long they are kept.',
    'Paste the Terraform below. Assume a KMS key, a backup role, and a second vault in another region already exist.',
  ],
  identity: {
    requirement: 'The backup plan is named as the brief specifies',
    missing:
      'The backup plan name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_backup_plan').some((pl) =>
        (stringAttr(pl, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'vault_and_plan',
      requirement: 'A vault to store backups in and a plan that targets it',
      missing: 'No aws_backup_vault was found, or no rule on the plan names a target_vault_name.',
      matters:
        'The vault is where recovery points land and the plan is what puts them there. A plan targeting no vault has nowhere to write.',
      run: (b) =>
        findResources(b, 'aws_backup_vault').length > 0 &&
        findResources(b, 'aws_backup_plan').some((pl) =>
          findNested(pl, 'rule').some((r) => r.attributes['target_vault_name'] !== undefined),
        ),
    },
    {
      id: 'runs_on_a_schedule',
      requirement: 'The plan runs on a schedule',
      missing: 'No rule with a schedule was found.',
      matters:
        'A plan with no schedule is a description of a backup rather than one. The brief rules out the version that depends on somebody remembering, and the schedule is the part that does that.',
      run: (b) =>
        findResources(b, 'aws_backup_plan').some((pl) =>
          findNested(pl, 'rule').some((r) => r.attributes['schedule'] !== undefined),
        ),
    },
    {
      id: 'covers_something',
      disqualifying: true,
      remedy:
        'Add an aws_backup_selection naming the resources, or a tag the resources carry, then submit again. If a plan like this one is already applied anywhere, check what it has actually been protecting before trusting it.',
      requirement: 'A selection says which resources the plan covers',
      missing:
        'No aws_backup_selection was found, or none names resources, a selection_tag, or a condition.',
      matters:
        'This is the check the task turns on, and it is the one that produces a green job history for an empty set. A plan with no selection runs exactly on schedule, completes successfully, and backs up nothing at all. Nothing about the console says so, and the discovery happens during a restore.',
      run: (b) =>
        findResources(b, 'aws_backup_selection').some(
          (sel) =>
            sel.attributes['plan_id'] !== undefined &&
            (sel.attributes['resources'] !== undefined ||
              findNested(sel, 'selection_tag').length > 0 ||
              findNested(sel, 'condition').length > 0),
        ),
    },
    {
      id: 'survives_losing_the_region',
      requirement: 'Recovery points are copied to a second vault',
      missing: 'No copy_action with a destination_vault_arn was found.',
      matters:
        'A backup in the same account and region as its source is protected against a bad afternoon and nothing larger. The brief names the larger case, and a copy elsewhere is the only part of this that answers it. Everything else is a better version of one basket.',
      run: (b) =>
        findResources(b, 'aws_backup_plan').some((pl) =>
          findNested(pl, 'copy_action').some(
            (c) => c.attributes['destination_vault_arn'] !== undefined,
          ),
        ),
    },
    {
      id: 'retention_is_bounded',
      requirement: 'Recovery points expire',
      missing: 'No lifecycle with delete_after was found on a rule.',
      matters:
        'Without an expiry every recovery point is kept for ever, and the bill grows with the schedule rather than with the data. It is also more copies of the same records living longer than anybody decided they should.',
      run: (b) =>
        findResources(b, 'aws_backup_plan').some((pl) =>
          findNested(pl, 'rule').some((r) =>
            // Direct children only. A copy_action carries its own lifecycle,
            // and an expiry on the offsite copy says nothing about how long
            // the primary recovery points are kept.
            directBlocks(r, 'lifecycle').some((l) => l.attributes['delete_after'] !== undefined),
          ),
        ),
    },
  ],
};

/**
 * The fifth cloud-security task, on the key everything else depends on.
 *
 * Four tasks in this track already say "encrypted with a key you name". None
 * of them asks what that key is, and the answer usually turns out to be a key
 * with a policy nobody read, granting the whole account, that has never
 * rotated.
 *
 * Two defaults do most of the damage. Rotation is off unless asked for, so a
 * key created years ago is still using the material it was created with. And
 * the policy AWS writes for you when you leave it out delegates to IAM for the
 * entire account, which means the key is readable by anybody who can be
 * granted an IAM permission, and the key policy stops being a boundary at all.
 */
const KEY_MANAGEMENT: GradedTask = {
  id: 'task_key_management_v1',
  capabilities: ['data_protection', 'least_privilege_access'],
  track: 'cloud_security',
  title: 'Own a key rather than just having one',
  timeboxMinutes: 35,
  brief: (p) => [
    'One key will encrypt the exports this business sends to its accountants. Two roles need to use it and nobody else should.',
    'Name the key alias ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'The material this key uses should not still be the material it was created with in three years.',
    'Say who may use it. Be specific: a key policy that defers to the account is not a decision about who.',
    'Deleting a key destroys everything it ever encrypted, so make that hard to do quickly.',
    'Paste the Terraform below. Assume the two roles already exist.',
  ],
  identity: {
    requirement: 'The key alias is named as the brief specifies',
    missing:
      'The alias name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_kms_alias').some((a) =>
        (stringAttr(a, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'key_and_alias',
      requirement: 'A key with an alias pointing at it',
      missing: 'No aws_kms_key with an aws_kms_alias targeting it was found.',
      matters:
        'Key ids are generated and meaningless. The alias is what everything else refers to, and it is what lets a key be replaced later without editing every resource that used it.',
      run: (b) =>
        findResources(b, 'aws_kms_key').length > 0 &&
        findResources(b, 'aws_kms_alias').some((a) => a.attributes['target_key_id'] !== undefined),
    },
    {
      id: 'rotation_enabled',
      requirement: 'Key rotation is on',
      missing: 'enable_key_rotation is absent or false. It defaults to false.',
      matters:
        'Without it the key is still using the material it was created with, for as long as it exists. The longer one piece of material protects everything, the more a single exposure is worth and the further back it reaches.',
      run: (b) =>
        findResources(b, 'aws_kms_key').some((k) => boolAttr(k, 'enable_key_rotation') === true),
    },
    {
      id: 'policy_names_who',
      requirement: 'The key policy names the principals allowed to use it',
      missing: 'No policy was set on the key, or it names no specific role or account principal.',
      matters:
        'Left out, AWS writes a policy delegating to IAM for the whole account, which means anybody who can be granted an IAM permission can use the key. That is the moment the key policy stops being a second boundary and becomes a restatement of the first.',
      run: (b) => {
        const keys = findResources(b, 'aws_kms_key');
        if (!keys.some((k) => k.attributes['policy'] !== undefined)) return false;
        const text = rawText(keys);
        return /aws_iam_role\.|arn:aws:iam::/i.test(text);
      },
    },
    {
      id: 'not_open_to_the_account',
      requirement: 'The policy does not hand the key to every principal',
      missing:
        'The key policy grants a wildcard principal, or grants kms actions with a wildcard action.',
      matters:
        'A key policy naming a role and also granting everybody has granted everybody. This is the check that separates a scoped policy from one that had a scoped statement pasted above the permissive one it was meant to replace.',
      run: (b) => {
        // Includes policy documents deliberately, and this direction of the
        // change closes a hole rather than opening one: a wildcard principal
        // written into a data source used to be invisible here, so the most
        // permissive answer passed a check named for catching it.
        const text = policyText(b, 'aws_kms_key');
        if (/"Principal"\s*[=:]\s*"\*"/i.test(text)) return false;
        if (/Principal\s*=\s*"\*"/i.test(text)) return false;
        return !/"?Action"?\s*[=:]\s*"\*"/i.test(text);
      },
    },
    {
      id: 'deletion_is_slow',
      requirement: 'The deletion window is longer than the minimum',
      missing: 'deletion_window_in_days is absent or set to the seven day minimum.',
      matters:
        'Scheduling a key for deletion destroys everything it ever encrypted, and the window is the only period in which that can be undone. Seven days spans one holiday. The brief asks for it to be hard to do quickly.',
      run: (b) =>
        findResources(b, 'aws_kms_key').some((k) => {
          const window = k.attributes['deletion_window_in_days'];
          return window !== undefined && window.kind === 'number' && window.value > 7;
        }),
    },
  ],
};

/**
 * The sixth cloud-security task, on letting somebody else in on purpose.
 *
 * Every other task in this track keeps people out. This one grants access
 * deliberately, to a third party, which is the case that produces the subtlest
 * mistake in cloud identity: the confused deputy.
 *
 * A cross-account role trusting a vendor account is assumable by that vendor
 * on behalf of any of its customers, not just you. If the vendor can be
 * persuaded to use your account id, and it usually can, because your account
 * id is not a secret, then another of their customers reads your data using
 * the vendor's own legitimate credentials. Nothing in your logs looks unusual.
 * The external id is what closes that, and it is a single condition that most
 * submissions leave out because everything works without it.
 */
const THIRD_PARTY_ACCESS: GradedTask = {
  id: 'task_third_party_access_v1',
  capabilities: ['least_privilege_access'],
  track: 'cloud_security',
  title: 'Let a vendor into your account without letting in their other customers',
  timeboxMinutes: 35,
  brief: (p) => [
    'A monitoring vendor needs read access to this account. They run one account of their own and serve every customer from it.',
    'Name the role ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Your account id is not a secret. Assume the vendor can be talked into using it by somebody who is not you.',
    'They need to read, and only to read.',
    'You should be able to end the arrangement without asking them to do anything.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The role is named as the brief specifies',
    missing:
      'The role name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_iam_role').some((r) => (stringAttr(r, 'name') ?? '').includes(p.token)),
  },
  passMark: 0,
  checks: [
    {
      id: 'cross_account_role',
      requirement: 'A role another account can assume',
      missing:
        'No aws_iam_role whose trust policy allows sts:AssumeRole from an account principal was found.',
      matters:
        'A role is the right shape for this. Handing over a user and keys would give the vendor a credential you cannot expire and cannot watch.',
      run: (b) => {
        const text = policyText(b, 'aws_iam_role');
        return /sts:AssumeRole/i.test(text) && /"?AWS"?\s*[=:]/i.test(text);
      },
    },
    {
      id: 'external_id_required',
      requirement: 'The trust policy requires an external id',
      missing: 'No sts:ExternalId condition was found in the trust policy.',
      matters:
        'This is the check the task turns on, and the reason is not obvious, which is why it is usually missing. The vendor assumes this role from their own account on behalf of all their customers. Without an external id, persuading them to use your account id is enough for another of their customers to read your data, using the vendor credentials they legitimately hold. Nothing in your logs looks wrong, because nothing is wrong except who asked.',
      run: (b) => /sts:ExternalId/i.test(rawText(b)),
    },
    {
      id: 'read_only_permissions',
      requirement: 'The permissions granted are read-only',
      missing: 'A policy attached to the role grants a write, delete, or wildcard action.',
      matters:
        'A monitoring vendor that can change things can be used to change things. Read access that turns out to be too much is an exposure; write access that turns out to be too much is an incident.',
      run: (b) => {
        // Reads actions from both renderings. Reading only the jsonencode
        // form meant a policy written as an aws_iam_policy_document produced
        // no actions at all, so this check failed every candidate who used
        // the idiomatic form, correct answer or not.
        const actions = policyActionValues(b);
        if (actions.length === 0) return false;
        // Both spellings of everything: a bare "*", and "service:*", which
        // grants every action that service has including all of its writes.
        if (actions.some(isWildcardAction)) return false;
        return !actions.some((a) =>
          /:(Put|Create|Delete|Update|Write|Modify|Attach|Detach|Terminate)/i.test(a),
        );
      },
    },
    {
      id: 'session_is_bounded',
      requirement: 'The session has a maximum duration',
      missing: 'No max_session_duration was set on the role.',
      matters:
        'The default session lasts an hour, which is fine, but saying so is what makes it a decision. A credential the vendor holds for as long as the default allows is the window in which a leak on their side is usable on your account.',
      run: (b) =>
        findResources(b, 'aws_iam_role').some(
          (r) => r.attributes['max_session_duration'] !== undefined,
        ),
    },
    {
      id: 'revocable_without_them',
      requirement: 'Access can be ended from your side alone',
      missing:
        'No aws_iam_role_policy or aws_iam_role_policy_attachment was found, so nothing is attached that you could remove.',
      matters:
        'The brief asks to be able to end this without their cooperation. A role with its permissions attached separately is removed or emptied on your side and the access stops. Permissions living anywhere else mean ending the arrangement is a conversation.',
      run: (b) =>
        findResources(b, 'aws_iam_role_policy').length > 0 ||
        findResources(b, 'aws_iam_role_policy_attachment').length > 0,
    },
  ],
};

/**
 * The seventh cloud-security task, on the finding nobody read.
 *
 * The trail task records what happened so it can be reconstructed later. This
 * is the other half: something that looks at activity as it happens and says
 * this is not normal. The two fail differently. A trail with nothing reading
 * it is useless after an incident. A detector with nothing reading it is
 * useless during one.
 *
 * Turning GuardDuty on is one resource and is where most submissions stop,
 * which produces findings in a console nobody opens. The graded work is the
 * path from a finding to a person, and the severity filter on that path,
 * because a route that forwards everything gets muted within a fortnight and
 * then the path exists and carries nothing anybody reads.
 */
const THREAT_DETECTION: GradedTask = {
  id: 'task_threat_detection_v1',
  capabilities: ['observability_and_alerting'],
  track: 'cloud_security',
  title: 'Notice an intrusion while it is still happening',
  timeboxMinutes: 35,
  brief: (p) => [
    'Nothing in this account currently looks at activity and forms an opinion about it. Credentials could be used from anywhere tonight and the first sign would be a bill or a customer.',
    'Name the alert topic ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Turn on detection, and then do the part that is usually skipped: get what it finds to a person.',
    'Most of what it finds is not urgent. Somebody who is paged for all of it stops reading any of it, so decide what is worth interrupting a person for.',
    'Paste the Terraform below.',
  ],
  identity: {
    requirement: 'The alert topic is named as the brief specifies',
    missing:
      'The topic name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_sns_topic').some((t) =>
        (stringAttr(t, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'detector_enabled',
      requirement: 'A detector, switched on',
      missing: 'No aws_guardduty_detector with enable set true was found.',
      matters:
        'A detector declared and disabled is the same as none, and it is worse to look at, because the account inventory says detection is configured.',
      run: (b) =>
        findResources(b, 'aws_guardduty_detector').some((d) => boolAttr(d, 'enable') === true),
    },
    {
      id: 'findings_are_routed',
      requirement: 'A rule matches GuardDuty findings',
      missing: 'No aws_cloudwatch_event_rule with an event pattern mentioning GuardDuty was found.',
      matters:
        'Findings land in a console by default and stay there. The rule is the first half of the path out, and without it detection is a page somebody would have to think to open.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_event_rule').some((r) =>
          /guardduty/i.test(attrText(r, 'event_pattern')),
        ),
    },
    {
      id: 'only_what_matters',
      requirement: 'The rule filters on severity',
      missing: 'No severity filter was found in the event pattern.',
      matters:
        'This is the check the task turns on, and it is the one that decides whether any of this survives contact with a working week. A route carrying every finding is muted within a fortnight, and a muted route is worse than none, because everybody believes detection is still reaching somebody.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_event_rule').some((r) =>
          /severity/i.test(attrText(r, 'event_pattern')),
        ),
    },
    {
      id: 'the_rule_has_a_target',
      requirement: 'The rule sends findings to the topic',
      missing: 'No aws_cloudwatch_event_target was found.',
      matters:
        'A rule with no target matches events and does nothing with them. It is the quietest kind of broken, because the rule shows as enabled and the match count even goes up.',
      run: (b) => findResources(b, 'aws_cloudwatch_event_target').length > 0,
    },
    {
      id: 'a_person_receives_it',
      requirement: 'The topic has a subscriber',
      missing: 'No aws_sns_topic_subscription was found.',
      matters:
        'The brief asks for a person at the end of this. A topic with no subscription accepts every message and delivers none, which is the same silence as having built none of it.',
      run: (b) => findResources(b, 'aws_sns_topic_subscription').length > 0,
    },
  ],
};

/**
 * The eighth aws_cloud task, on the one bad record.
 *
 * The queue task covers the queue. This covers the thing reading from it, and
 * a stream fails in a way a queue does not: records are delivered in order
 * from a shard, so a batch that keeps failing is retried in place and nothing
 * behind it is ever read. One malformed record written at nine in the morning
 * stops every change after it, indefinitely, while the function reports
 * errors and the stream reports a growing age.
 *
 * Every check here is a different part of that one failure. Reporting which
 * items failed rather than the whole batch, splitting a failing batch to find
 * the record responsible, bounding the retries so the shard eventually moves
 * on, and keeping the record that caused it so somebody can look at it. A
 * mapping with none of them is the default, and the default blocks for ever.
 */
const STREAM_CONSUMER: GradedTask = {
  id: 'task_stream_consumer_v1',
  capabilities: ['failure_handling'],
  track: 'aws_cloud',
  title: 'Read a change stream that one bad record cannot stop',
  timeboxMinutes: 40,
  brief: (p) => [
    'A function reads a table change stream and copies each change into a search index. Records arrive in order and are read in batches.',
    'The function is called ' +
      p.token +
      '. Write that name out in the mapping rather than referring to the resource, so the submission can be matched to you. One using a different name is graded as somebody elses.',
    'Some records will fail to process. Most of those will succeed if tried again.',
    'One of them will never succeed, whatever you do, and it will be somewhere in the middle of a batch of a hundred.',
    'Nothing behind that record may be held up waiting for it, and the record itself must not simply be discarded.',
    'Paste the Terraform below. Assume the table, its stream, the function, and a queue for rejected records already exist.',
  ],
  identity: {
    requirement: 'The function name is as the brief specifies',
    missing:
      'The function name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_lambda_event_source_mapping').some((m) =>
        attrText(m, 'function_name').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'stream_mapping',
      requirement: 'A mapping from the stream to the function',
      missing:
        'No aws_lambda_event_source_mapping with an event_source_arn, a function_name, and a starting_position was found.',
      matters:
        'The mapping is what reads the stream on the function behalf. A stream needs a starting position as well, because unlike a queue it has history, and where to begin is a decision rather than a default.',
      run: (b) =>
        findResources(b, 'aws_lambda_event_source_mapping').some(
          (m) =>
            m.attributes['event_source_arn'] !== undefined &&
            m.attributes['function_name'] !== undefined &&
            m.attributes['starting_position'] !== undefined,
        ),
    },
    {
      id: 'partial_failures_reported',
      requirement: 'The function reports which items failed, not the batch',
      missing: 'function_response_types does not include ReportBatchItemFailures.',
      matters:
        'This is the check the task turns on. Without it one failing record fails the whole batch, so ninety-nine records that succeeded are delivered again on the retry, and again after that. The work is repeated every attempt and the position never advances.',
      run: (b) =>
        findResources(b, 'aws_lambda_event_source_mapping').some((m) => {
          const types = m.attributes['function_response_types'];
          if (types === undefined) return false;
          if (types.kind === 'list') {
            return types.items.some(
              (i) => i.kind === 'string' && /ReportBatchItemFailures/i.test(i.value),
            );
          }
          return types.kind === 'string' && /ReportBatchItemFailures/i.test(types.value);
        }),
    },
    {
      id: 'poison_record_isolated',
      requirement: 'A failing batch is split to find the record responsible',
      missing: 'bisect_batch_on_function_error is absent or false.',
      matters:
        'The brief puts the bad record in the middle of a hundred. Splitting the batch on failure narrows it down by halves until the one record is on its own, which is what lets the other ninety-nine through instead of holding them behind it.',
      run: (b) =>
        findResources(b, 'aws_lambda_event_source_mapping').some(
          (m) => boolAttr(m, 'bisect_batch_on_function_error') === true,
        ),
    },
    {
      id: 'retries_are_bounded',
      requirement: 'Retries stop eventually',
      missing:
        'No maximum_retry_attempts or maximum_record_age_in_seconds was set, so a record is retried until it expires from the stream.',
      matters:
        'A stream delivers in order, so a record retried for ever is a shard that never moves. Everything written after it waits, the function keeps erroring, and the only visible symptom is an iterator age climbing all day.',
      run: (b) =>
        findResources(b, 'aws_lambda_event_source_mapping').some(
          (m) =>
            m.attributes['maximum_retry_attempts'] !== undefined ||
            m.attributes['maximum_record_age_in_seconds'] !== undefined,
        ),
    },
    {
      id: 'rejected_records_kept',
      requirement: 'A record that never succeeds is kept somewhere',
      missing: 'No destination_config with an on_failure destination_arn was found.',
      matters:
        'Bounding the retries is what lets the stream move on, and on its own it means the record is dropped once the bound is reached. The brief rules that out. The failure destination is the difference between moving past a bad record and losing it.',
      run: (b) =>
        findResources(b, 'aws_lambda_event_source_mapping').some((m) =>
          findNested(m, 'destination_config').some((d) =>
            findNested(d, 'on_failure').some((f) => f.attributes['destination_arn'] !== undefined),
          ),
        ),
    },
  ],
};

/**
 * The eighth cloud-security task, on the record of the network.
 *
 * The trail task records API calls, which is what somebody asked AWS to do.
 * This records packets, which is what actually moved. They answer different
 * questions and neither substitutes for the other: a trail shows a role
 * reading a bucket, and only flow logs show four gigabytes leaving for an
 * address nobody recognises.
 *
 * The interesting default is not that flow logs are off. It is what people
 * choose when they turn them on. Logging rejected traffic is the intuitive
 * answer, it is cheaper, and it feels like the security-relevant half. It is
 * the wrong half. Rejected traffic is the attempts that failed. An intrusion
 * that worked is accepted traffic, and a flow log recording only rejects has
 * no entry for any of it, which means the one investigation the logs exist
 * for is the one they cannot answer.
 */
const NETWORK_RECORD: GradedTask = {
  id: 'task_network_record_v1',
  capabilities: ['auditability', 'observability_and_alerting'],
  track: 'cloud_security',
  title: 'Record the traffic that succeeded, not just the traffic you blocked',
  timeboxMinutes: 35,
  brief: (p) => [
    'Nothing records network traffic in this account. If data left it last night, there is no way to find out.',
    'Name the log group ' +
      p.token +
      '. That name is yours; a submission using a different one is graded as somebody elses.',
    'Cover the whole network rather than a machine at a time, and assume new machines appear without anybody adding them to this.',
    'Think about which traffic is worth recording. The obvious answer is the wrong half.',
    'These records are large and constant, so say how long they are kept.',
    'During an incident, ten minutes is a long time to wait for the last few records.',
    'Paste the Terraform below. Assume the VPC and a role that may write logs already exist.',
  ],
  identity: {
    requirement: 'The log group is named as the brief specifies',
    missing:
      'The log group name in this submission is not the one your brief asked for. Use the name in your own brief.',
    run: (b, p) =>
      findResources(b, 'aws_cloudwatch_log_group').some((g) =>
        (stringAttr(g, 'name') ?? '').includes(p.token),
      ),
  },
  passMark: 0,
  checks: [
    {
      id: 'covers_the_whole_vpc',
      requirement: 'The flow log is attached to the VPC',
      missing:
        'No aws_flow_log with a vpc_id was found. Attaching to a subnet or an interface covers only what exists today.',
      matters:
        'A flow log on the VPC covers every interface in it, including the ones created next month. One attached per subnet or per interface is a list somebody has to remember to add to, and the machine nobody added is the one worth watching.',
      run: (b) =>
        findResources(b, 'aws_flow_log').some((f) => f.attributes['vpc_id'] !== undefined),
    },
    {
      id: 'records_what_succeeded',
      requirement: 'Traffic type covers accepted traffic',
      missing:
        'traffic_type is REJECT rather than ALL or ACCEPT, so nothing that succeeded is recorded.',
      matters:
        'This is the check the task turns on, and REJECT is the intuitive answer. Rejected traffic is the attempts that failed, which is the half you already survived. An intrusion that worked is accepted traffic, so a log of rejects alone has no record of the event it exists to investigate.',
      run: (b) =>
        findResources(b, 'aws_flow_log').some((f) => {
          const type = (stringAttr(f, 'traffic_type') ?? '').toUpperCase();
          return type === 'ALL' || type === 'ACCEPT';
        }),
    },
    {
      id: 'written_somewhere',
      requirement: 'The flow log has a destination',
      missing: 'No log_destination was set on the flow log.',
      matters:
        'The destination is where the records land and what everything afterwards reads. Without it the flow log describes what to capture and has nowhere to put it.',
      run: (b) =>
        findResources(b, 'aws_flow_log').some((f) => f.attributes['log_destination'] !== undefined),
    },
    {
      id: 'retention_is_set',
      requirement: 'The records expire',
      missing: 'No retention_in_days was set on the log group, and no S3 lifecycle rule was found.',
      matters:
        'Flow logs are continuous and large, and kept for ever they become one of the biggest line items in an account. They are also a detailed record of who talked to whom, which is not something to hold indefinitely without deciding to.',
      run: (b) =>
        findResources(b, 'aws_cloudwatch_log_group').some(
          (g) => g.attributes['retention_in_days'] !== undefined,
        ) || findResources(b, 'aws_s3_bucket_lifecycle_configuration').length > 0,
    },
    {
      id: 'aggregation_is_tight',
      requirement: 'Records are aggregated at the shorter interval',
      missing:
        'max_aggregation_interval is absent or 600. The default is 600 seconds, which is ten minutes.',
      matters:
        'The interval is how long a record is held before it is written, so on the default the most recent ten minutes do not exist yet. During an incident that is exactly the window somebody is trying to read, and waiting for it is the difference between watching something happen and reconstructing it afterwards.',
      run: (b) =>
        findResources(b, 'aws_flow_log').some((f) => {
          const interval = f.attributes['max_aggregation_interval'];
          return interval !== undefined && interval.kind === 'number' && interval.value === 60;
        }),
    },
  ],
};

export const GRADED_TASKS: GradedTask[] = [
  S3_LOCKDOWN,
  LEAST_PRIVILEGE_ROLE,
  AZURE_SCOPED_IDENTITY,
  GCP_SCOPED_IDENTITY,
  PLATFORM_HYGIENE,
  MODEL_SERVING,
  FEATURE_PATH,
  MODEL_MONITORING,
  MODEL_GOVERNANCE,
  TRAINING_RUN,
  ASYNC_INFERENCE,
  SAFE_ROLLOUT,
  RETRAINING_LOOP,
  MODEL_WORKBENCH,
  NETWORK_EXPOSURE,
  AUDIT_TRAIL,
  SECRET_HANDLING,
  DURABLE_TABLE,
  PRIVATE_ORIGIN,
  RELIABLE_QUEUE,
  KEYLESS_DEPLOY,
  ALARM_THAT_FIRES,
  IMAGE_SUPPLY_CHAIN,
  RESILIENT_WORKFLOW,
  BOUNDED_API,
  COST_ALARM,
  RECOVERABLE_ESTATE,
  KEY_MANAGEMENT,
  THIRD_PARTY_ACCESS,
  THREAT_DETECTION,
  STREAM_CONSUMER,
  NETWORK_RECORD,
  // The multi-cloud set, kept at the end deliberately.
  //
  // Declaration order here is offer order, and the first task a track
  // offers is the one a candidate reads first. Adding these in the middle
  // silently changed what devops_platform and mlops led with, which three
  // existing tests caught. Nobody decided that, so the new tasks go last:
  // every track keeps the opening it already had, and the additions appear
  // after it.
  AZURE_PRIVATE_STORAGE,
  GCP_PRIVATE_DATABASE,
  AZURE_ALERT_REACHES_SOMEBODY,
  GCP_ALERT_SURVIVES_SILENCE,
  AZURE_QUEUE_LOSES_NOTHING,
  GCP_DEAD_LETTER_ACTUALLY_KEEPS,
  AZURE_RECOVERABLE_STORAGE,
  GCP_BUCKET_KEEPS_WHAT_IT_HOLDS,
  AZURE_BUDGET_WARNS_IN_TIME,
  GCP_BUDGET_TELLS_THE_RIGHT_PEOPLE,
  AZURE_AUDIT_TRAIL_EXISTS,
  GCP_AUDIT_RECORDS_READS,
  AZURE_CANARY_BEFORE_EVERYONE,
  GCP_CANARY_BEFORE_EVERYONE,
  AZURE_KEY_YOU_CANNOT_LOSE,
  GCP_KEY_YOU_CONTROL,
  AZURE_REGISTRY_NOT_A_BACK_DOOR,
  GCP_ONLY_SIGNED_IMAGES_RUN,
  AZURE_RERUNNABLE_JOB,
  GCP_RERUNNABLE_JOB,
];

/**
 * Derived from GRADED_TASKS itself, deliberately.
 *
 * This used to iterate a second, hand-maintained list of the same task
 * constants. The two agreed, but nothing made them agree: a task added to
 * GRADED_TASKS and forgotten here would keep the `passMark: 0` its literal
 * declares, and a pass mark of zero passes every submission - including an
 * empty one. On a platform whose product is proof, that failure mode does
 * not surface as an error; it silently issues verified evidence to people
 * who demonstrated nothing.
 *
 * Iterating the exported list removes the second list rather than checking
 * it, so the mistake is no longer available to make.
 */
for (const task of GRADED_TASKS) {
  task.passMark = task.checks.length - PASS_MARGIN;
}

/**
 * `null` for a track with no task.
 *
 * Every track has one as of 2026-08-27, but the null path stays and the UI
 * still handles it, because the rule that produced it has not changed:
 * a rubric that does not discriminate is worse than no rubric, since it puts
 * the platform's name on a result that means nothing. A future track ships
 * without a task until one is worth publishing.
 */
export function tasksForTrack(track: LaunchTrack): GradedTask[] {
  const available = tasksForCapabilities(TRACK_CAPABILITIES[track]);

  // Availability comes from capabilities; ORDER comes from the role. Without
  // this, three of the four tracks changed which task they lead with the
  // moment the capability layer landed, and MLOps opened with "Lock down a
  // bucket holding sensitive documents" — true to a capability it needs, and
  // a strange first thing to ask a model-platform engineer.
  //
  // So `track` on a task stops being a gate and becomes a relevance signal,
  // which is the honest thing for it to be: it records who the task was
  // written for, and that is worth something when deciding what to show
  // first. Declaration order is preserved inside each group, so the offer
  // stays stable.
  const writtenForThisRole = available.filter((task) => task.track === track);
  const borrowedFromElsewhere = available.filter((task) => task.track !== track);
  return [...writtenForThisRole, ...borrowedFromElsewhere];
}

/**
 * The lookup the engine actually runs on.
 *
 * A task is found by what it proves, never by the job title it was written
 * under. That is the whole change: adding a role becomes a line in
 * TRACK_CAPABILITIES, and every task already demonstrating one of its
 * capabilities is available to it without a new task, a new branch, or a
 * change to the grader.
 *
 * Order is the order tasks are declared in GRADED_TASKS rather than the order
 * capabilities were asked for, so the offer a candidate sees is stable
 * whatever their role's capability list looks like.
 */
export function tasksForCapabilities(capabilities: readonly Capability[]): GradedTask[] {
  const wanted = new Set(capabilities);
  return GRADED_TASKS.filter((task) => task.capabilities.some((c) => wanted.has(c)));
}

/** Every capability the existing tasks can actually demonstrate. */
export function coveredCapabilities(): Capability[] {
  const covered = new Set<Capability>();
  for (const task of GRADED_TASKS) for (const c of task.capabilities) covered.add(c);
  return [...covered].sort();
}

/**
 * Kept for callers that only need to know whether a track has anything at
 * all. Prefer tasksForTrack: a track can offer several, and picking the
 * first for a candidate would hide the rest.
 */
export function taskForTrack(track: LaunchTrack): GradedTask | null {
  return tasksForTrack(track)[0] ?? null;
}

export function taskById(id: string): GradedTask | null {
  return GRADED_TASKS.find((t) => t.id === id) ?? null;
}

export interface CheckResult {
  id: string;
  requirement: string;
  passed: boolean;
  /** Present only when it did not pass. */
  missing?: string;
  matters?: string;
}

export interface GradeResult {
  taskId: string;
  passed: boolean;
  /**
   * False when the submission is not the one this candidate was set. Kept
   * separate from the score so the reason is legible: somebody who did good
   * work under the wrong name should be told that, not handed a score.
   */
  identityOk: boolean;
  identityMissing?: string;
  score: number;
  outOf: number;
  passMark: number;
  checks: CheckResult[];
  /**
   * Set when a disqualifying check failed. The score may still be at or above
   * the pass mark, so the reason has to be stated rather than inferred from
   * the numbers, which would otherwise read as a passing result marked
   * failed for no visible cause.
   */
  disqualifiedBy?: string;
  /** The remedy for the check that ended it, when it named one. */
  disqualifiedRemedy?: string;
  /** Set when the submission could not be read at all. */
  refused?: string;
}

/**
 * Pure. No clock, no network, no randomness, no model: the same text scores
 * the same way for ever, which is the property that makes this verification
 * rather than an opinion.
 */
export function gradeSubmission(
  task: GradedTask,
  submission: string,
  params: TaskParams,
): GradeResult {
  const parsed = parseHcl(submission);
  if (parsed.refused) {
    return {
      taskId: task.id,
      passed: false,
      identityOk: false,
      score: 0,
      outOf: task.checks.length,
      passMark: task.passMark,
      checks: [],
      refused: parsed.refused,
    };
  }

  const checks: CheckResult[] = task.checks.map((check) => {
    // A check that throws on strange input is a bug in the rubric, and it
    // must not fail the candidate for it. Treated as not demonstrated, which
    // is the same outcome as an honest miss and never worse.
    let passed = false;
    try {
      passed = check.run(parsed.blocks, params);
    } catch {
      passed = false;
    }
    return passed
      ? { id: check.id, requirement: check.requirement, passed: true }
      : {
          id: check.id,
          requirement: check.requirement,
          passed: false,
          missing: check.missing,
          matters: check.matters,
        };
  });

  let identityOk = false;
  try {
    identityOk = task.identity.run(parsed.blocks, params);
  } catch {
    identityOk = false;
  }

  const score = checks.filter((c) => c.passed).length;

  // A disqualifying check ends the attempt the same way the identity gate
  // does, and for the same reason: the pass mark absorbs one miss, so
  // without this a submission could commit the exact harm the task tests for
  // and still pass on the strength of the other four checks.
  const disqualifying = task.checks.find(
    (c) => c.disqualifying && checks.some((r) => r.id === c.id && !r.passed),
  );

  // The identity gate sits OUTSIDE the score deliberately. The pass mark
  // allows one miss, so a borrowed submission failing only on the name would
  // still score enough to pass, which would defeat the entire point of
  // personalising the task. It ends the attempt whatever the score.
  return {
    taskId: task.id,
    passed: identityOk && score >= task.passMark && disqualifying === undefined,
    identityOk,
    ...(identityOk ? {} : { identityMissing: task.identity.missing }),
    score,
    outOf: task.checks.length,
    passMark: task.passMark,
    checks,
    ...(disqualifying
      ? {
          disqualifiedBy: disqualifying.id,
          ...(disqualifying.remedy ? { disqualifiedRemedy: disqualifying.remedy } : {}),
        }
      : {}),
  };
}

/** What goes on the evidence item when a task is passed. */
export function gradedTaskDetail(task: GradedTask, result: GradeResult): string {
  return `${task.title}: ${result.score} of ${result.outOf} requirements met, scored against a published rubric.`;
}
