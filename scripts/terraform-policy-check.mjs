#!/usr/bin/env node
// Lightweight, dependency-free static policy checker over the committed
// Terraform source tree — same style/spirit as scripts/scan-secrets.mjs.
// Not a full OPA/Sentinel engine: it text-scans the .tf files themselves,
// which is sufficient to catch the specific failure modes Prompt 5 asks
// for and keeps this dependency-free, matching the rest of this project's
// tooling. Run in CI on every PR; never run terraform apply.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const infraRoot = join(root, 'infrastructure');

function listTfFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.terraform') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTfFiles(full));
    } else if (entry.endsWith('.tf')) {
      out.push(full);
    }
  }
  return out;
}

const files = listTfFiles(infraRoot);
const findings = [];

function check(condition, file, message) {
  if (condition) findings.push(`${relative(root, file)}: ${message}`);
}

// --- CloudFront: the default cache behaviour must not be a long-TTL
// managed policy. ---
//
// CloudFront picks a cache behaviour by matching the path pattern against
// the URI the browser sent, before any viewer-request function rewrites it.
// This project serves a Next.js static export with extensionless routes, so
// an ordered behaviour matching "*.html" never sees the requests that matter
// and the default behaviour is what actually serves every page — which was
// the arrangement here until it was read off the live distribution.
//
// That did not cache anything for a day, because scripts/sync-static-site.mjs
// uploads HTML with max-age=0 and CloudFront honours an origin directive over
// a policy's default TTL. It meant the distribution's correctness rested
// entirely on that script continuing to set the right header on every object,
// with nothing in the configuration behind it. This rule is that backing.
//
// Matched on the managed policy's data source, which is the only way this
// module names a long TTL.
for (const file of files) {
  if (!file.endsWith(join('static-site', 'main.tf'))) continue;
  const source = readFileSync(file, 'utf8');
  const defaultBlock = /default_cache_behavior\s*\{[\s\S]*?\n {2}\}/.exec(source);
  check(
    defaultBlock !== null && /caching_optimized/.test(defaultBlock[0]),
    file,
    'default_cache_behavior uses the long-TTL managed CachingOptimized policy. It serves every ' +
      'extensionless page, and this export does not content-hash HTML, so nothing but the origin ' +
      'Cache-Control the sync script happens to set would stop a page caching for a day. Give the ' +
      'default a short TTL and scope CachingOptimized to a path pattern the browser actually ' +
      'requests, such as /_next/static/*.',
  );
}

// --- Architecture: no always-on compute, no Route 53 hosted zone, no
// Vercel deployment resource (CLAUDE.md hard boundaries). ---
const FORBIDDEN_RESOURCE_TYPES = [
  'aws_instance',
  'aws_launch_template',
  'aws_autoscaling_group',
  'aws_nat_gateway',
  'aws_internet_gateway',
  'aws_vpc',
  'aws_subnet',
  'aws_lb',
  'aws_alb',
  'aws_elb',
  'aws_ecs_cluster',
  'aws_ecs_service',
  'aws_ecs_task_definition',
  'aws_eks_cluster',
  'aws_db_instance',
  'aws_rds_cluster',
  'aws_elasticache_cluster',
  'aws_elasticache_replication_group',
  'aws_route53_zone',
  'aws_cognito_user_pool',
];

function stripComments(content) {
  // Only for the Cognito-mention check below: this project's own comments
  // legitimately name "Cognito" to explain why it's absent (see
  // docs/COST_GUARDRAILS.md's identical documentation-file allowlist for
  // the same reason) — code, not prose, is what must never reference it.
  return content
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join('\n');
}

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const type of FORBIDDEN_RESOURCE_TYPES) {
    const re = new RegExp(`resource\\s+"${type}"`);
    check(
      re.test(content),
      file,
      `forbidden resource type "${type}" (see CLAUDE.md hard boundaries)`,
    );
  }
  check(
    /provider\s+"vercel"/.test(content),
    file,
    'a "vercel" Terraform provider — Vercel stays DNS/registrar-only, never a managed resource',
  );
  check(
    /\bCognito\b/i.test(stripComments(content)),
    file,
    'the literal term "Cognito" outside a comment — see docs/adr/0001-no-cognito-passwordless-email-auth.md',
  );
}

// --- Every aws_s3_bucket must have a matching public-access-block with all
// four flags true, and a matching server-side-encryption config. ---
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const bucketResources = [...content.matchAll(/resource\s+"aws_s3_bucket"\s+"(\w+)"/g)].map(
    (m) => m[1],
  );
  for (const name of bucketResources) {
    const pabRe = new RegExp(
      `resource\\s+"aws_s3_bucket_public_access_block"\\s+"${name}"[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`,
    );
    const pabMatch = content.match(pabRe);
    check(
      !pabMatch,
      file,
      `aws_s3_bucket.${name} has no matching aws_s3_bucket_public_access_block`,
    );
    if (pabMatch) {
      const body = pabMatch[1];
      for (const flag of [
        'block_public_acls',
        'block_public_policy',
        'ignore_public_acls',
        'restrict_public_buckets',
      ]) {
        const flagRe = new RegExp(`${flag}\\s*=\\s*true`);
        check(
          !flagRe.test(body),
          file,
          `aws_s3_bucket.${name}'s public-access-block does not set ${flag} = true`,
        );
      }
    }

    const sseRe = new RegExp(
      `resource\\s+"aws_s3_bucket_server_side_encryption_configuration"\\s+"${name}"`,
    );
    check(
      !sseRe.test(content),
      file,
      `aws_s3_bucket.${name} has no matching server-side-encryption configuration`,
    );
  }
}

// --- Every aws_dynamodb_table must enable server_side_encryption. Every
// production table must set deletion_protection_enabled = true. ---
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (/resource\s+"aws_dynamodb_table"/.test(content)) {
    check(
      !/server_side_encryption\s*\{\s*enabled\s*=\s*true/.test(content) &&
        !/server_side_encryption\.enabled/.test(content),
      file,
      'aws_dynamodb_table without server_side_encryption { enabled = true }',
    );
  }
}
{
  const prodDataCall = join(infraRoot, 'envs', 'production', 'main.tf');
  const content = readFileSync(prodDataCall, 'utf8');
  const moduleBlock = content.match(/module\s+"core_table"\s*\{[\s\S]*?\n\}/);
  check(
    !moduleBlock,
    prodDataCall,
    'no module "core_table" block found to check for deletion protection',
  );
  check(
    !!moduleBlock && !/deletion_protection_enabled\s*=\s*true/.test(moduleBlock[0]),
    prodDataCall,
    'production module "core_table" does not set deletion_protection_enabled = true',
  );
}

// --- Every aws_cloudwatch_log_group must set a finite retention_in_days
// (an omitted/absent value means "never expire" in AWS). ---
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const logGroupBlocks = [
    ...content.matchAll(/resource\s+"aws_cloudwatch_log_group"\s+"(\w+)"\s*\{([\s\S]*?)\n\}/g),
  ];
  for (const [, name, body] of logGroupBlocks) {
    check(
      !/retention_in_days\s*=/.test(body),
      file,
      `aws_cloudwatch_log_group.${name} has no retention_in_days set (uncapped retention)`,
    );
  }
}

// --- No wildcard admin: no AdministratorAccess managed policy attachment,
// no bare Action="*"/Resource="*" statement in any IAM policy document. ---
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  check(
    /AdministratorAccess/.test(content),
    file,
    'references the AdministratorAccess managed policy — workloads never get it (CLAUDE.md)',
  );
  const statementBlocks = [...content.matchAll(/statement\s*\{([\s\S]*?)\n\s{2}\}/g)];
  for (const [, body] of statementBlocks) {
    const hasWildcardAction = /actions\s*=\s*\[\s*"\*"\s*\]/.test(body);
    const hasWildcardResource = /resources\s*=\s*\[\s*"\*"\s*\]/.test(body);
    check(
      hasWildcardAction && hasWildcardResource,
      file,
      'an IAM policy statement grants actions=["*"] with resources=["*"]',
    );
  }
}

// --- Secret variables: no committed default value that looks like a real
// secret, and every SecureString parameter must ignore_changes on value. ---
const SECRET_LOOKING_VALUE =
  /sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/;
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  check(
    SECRET_LOOKING_VALUE.test(content),
    file,
    'a Terraform default/value that looks like a real secret',
  );

  const ssmSecureStrings = [
    ...content.matchAll(/resource\s+"aws_ssm_parameter"\s+"(\w+)"\s*\{([\s\S]*?)\n\}/g),
  ];
  for (const [, name, body] of ssmSecureStrings) {
    if (/type\s*=\s*"SecureString"/.test(body)) {
      check(
        !/ignore_changes\s*=\s*\[\s*value\s*\]/.test(body),
        file,
        `aws_ssm_parameter.${name} is a SecureString without lifecycle { ignore_changes = [value] } — a real secret entered by the founder would be reverted on the next apply`,
      );
    }
  }
}

// --- Static-site CSP: allow_inline_scripts (Phase 7 slice 11 — Next.js
// static-export hydration needs script-src 'unsafe-inline', confirmed live)
// must never widen beyond exactly that. The strict directives it sits
// alongside must stay intact, and 'unsafe-eval'/wildcard/data: script
// sources must never appear, in either environment. ---
{
  const staticSiteModule = join(infraRoot, 'modules', 'static-site', 'main.tf');
  const content = readFileSync(staticSiteModule, 'utf8');
  const cspBlock = content.match(/content_security_policy\s*=\s*join\([\s\S]*?\]\)\)/);
  check(!cspBlock, staticSiteModule, 'no content_security_policy join(...) block found to check');
  if (cspBlock) {
    const policy = cspBlock[0];
    check(!/object-src 'none'/.test(policy), staticSiteModule, "CSP is missing object-src 'none'");
    check(
      !/frame-ancestors 'none'/.test(policy),
      staticSiteModule,
      "CSP is missing frame-ancestors 'none'",
    );
    check(!/base-uri 'self'/.test(policy), staticSiteModule, "CSP is missing base-uri 'self'");
    check(
      !/form-action 'self'/.test(policy),
      staticSiteModule,
      "CSP is missing form-action 'self'",
    );
    check(
      /unsafe-eval/.test(policy),
      staticSiteModule,
      'CSP references unsafe-eval — Next.js docs confirm this is dev-only, never required in production',
    );
    check(
      /script-src[^"]*(\*|data:)/.test(policy),
      staticSiteModule,
      'CSP script-src contains a wildcard or data: source',
    );
  }
  for (const envFile of ['test', 'production'].map((env) =>
    join(infraRoot, 'envs', env, 'main.tf'),
  )) {
    const envContent = readFileSync(envFile, 'utf8');
    const staticSiteBlock = envContent.match(/module\s+"static_site"\s*\{[\s\S]*?\n\}/);
    if (!staticSiteBlock) continue;
    const setsAllowInline = /allow_inline_scripts\s*=\s*true/.test(staticSiteBlock[0]);
    // Both environments must set it, and this used to forbid it in
    // production.
    //
    // The original rule was written while production was still
    // aspirational and had never been applied. It read as good hygiene:
    // 'unsafe-inline' does weaken script-src, so hold the strict default
    // where it matters most. What it actually produced, the first time
    // production served a real visitor, was a site that rendered
    // perfectly and did nothing at all — Next.js's static export emits
    // inline hydration scripts, a bare 'self' blocks them, React never
    // attaches, and every button, form and fetch on every page is inert.
    // Sign-in looked broken with no error anywhere, because the browser
    // never made a request for anything to log.
    //
    // Nonces cannot fix a static export: they require per-request
    // rendering, and there is no server here. Hashes were measured rather
    // than assumed — 38 distinct inline scripts across 38 pages, one per
    // page, changing whenever that page's content changes. Pinning them
    // in the CloudFront policy would mean any copy edit silently breaking
    // the whole site until somebody remembered to re-apply Terraform,
    // which is a worse failure than the one being avoided and of exactly
    // the kind that took a day to find.
    //
    // So the weakening is accepted deliberately, and bounded: it is
    // script-src only. 'unsafe-eval' stays forbidden, the wildcard and
    // data: checks above still run, and connect-src, object-src,
    // frame-ancestors, base-uri and form-action all stay strict. React
    // escapes interpolated content by default, which is the realistic
    // injection path in this app.
    //
    // Inverted rather than deleted, because the real defect was
    // divergence: test set it, production silently inherited the default,
    // and nothing compared the two.
    check(
      !setsAllowInline,
      envFile,
      `module "static_site" must set allow_inline_scripts = true — a Next.js static export ` +
        'cannot hydrate without it, and a page that renders but never becomes interactive ' +
        'fails silently in every environment that does not set it',
    );
  }
}

// --- SES: sending through a configuration set requires granting it. ---
//
// SES authorizes SendEmail against the configuration-set resource as well as
// the sending identity, so a function that names a configuration set in its
// environment but is only granted the identity fails with AccessDenied at
// send time — never at plan time, never in a test, and only for the one
// route nobody exercised. That is not hypothetical: it took down sign-in
// email once (fixed in PR #40) and then sat undetected in the peer-request
// route until a founder hit "Send the request" and got "Unexpected error".
//
// Cheap to state, impossible to notice by reading: hence a check.
function moduleBlocks(content) {
  // Brace-matched from each top-level `module "name" {`, ignoring braces on
  // comment lines so a commented-out block cannot unbalance the scan.
  const blocks = [];
  const re = /^module\s+"([^"]+)"\s*\{/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const lines = content.slice(match.index).split('\n');
    let consumed = 0;
    let body = '';
    for (const line of lines) {
      consumed += line.length + 1;
      body += `${line}\n`;
      if (!/^\s*(#|\/\/)/.test(line)) {
        for (const ch of line) {
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
        }
      }
      if (depth === 0 && body.includes('{')) break;
    }
    void i;
    blocks.push({ name: match[1], body });
    re.lastIndex = match.index + consumed;
  }
  return blocks;
}

let sesSendersSeen = 0;
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const { name, body } of moduleBlocks(content)) {
    if (!/SES_CONFIGURATION_SET_NAME\s*=/.test(body)) continue;
    sesSendersSeen += 1;
    // `ses_identity_arns` (plural) is the scheduled-job module's list form,
    // which carries the configuration-set ARN as one of its entries.
    const granted =
      /\bses_configuration_set_arn\s*=/.test(body) || /\bses_identity_arns\s*=/.test(body);
    check(
      !granted,
      file,
      `module "${name}" sends through a SES configuration set (SES_CONFIGURATION_SET_NAME is in ` +
        'its environment) but never grants it — add ses_configuration_set_arn, or SendEmail fails ' +
        'with AccessDenied at runtime only',
    );
  }
}

// A parsing regression would make the loop above silently check nothing, so
// the count it saw is asserted too. Every env that sends mail has at least
// the sign-in route; zero means the scan broke, not that the repo is clean.
check(
  sesSendersSeen === 0,
  join(infraRoot, 'envs'),
  'found no module sending through a SES configuration set — the SES grant scan is not matching ' +
    'anything, which means it is no longer checking what it claims to check',
);

// --- Evidence uploads: the bucket must allow the method the app signs. ---
//
// These two live in different languages in different directories and nothing
// connected them, so they drifted: the bucket allowed PUT while the server
// signed a POST, and every browser upload failed on a missing
// Access-Control-Allow-Origin. It is invisible to the test suite, because
// Playwright runs against local fakes and never performs the real
// browser-to-S3 hop, so a guard is the only thing that can hold the two
// together.
//
// The expected method is read from the signing code rather than written here
// twice. Switching the server to a presigned PUT would change what this
// expects, which is the point.
const presignSource = readFileSync(
  join(root, 'services', 'api', 'src', 'repositories', 's3-presign-repository.ts'),
  'utf8',
);
const signsPost = /createPresignedPost\s*\(/.test(presignSource);
const signedMethod = signsPost ? 'POST' : 'PUT';

let corsRulesSeen = 0;
for (const file of files) {
  const content = stripComments(readFileSync(file, 'utf8'));
  // Only the evidence bucket's rule, which is the one a browser uploads to.
  const block = /resource\s+"aws_s3_bucket_cors_configuration"\s+"evidence"\s*\{/.exec(content);
  if (!block) continue;
  const methods = /allowed_methods\s*=\s*\[([^\]]*)\]/.exec(content.slice(block.index));
  if (!methods) continue;
  corsRulesSeen += 1;
  const allowed = methods[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^"|"$/g, '').toUpperCase())
    .filter(Boolean);
  check(
    !allowed.includes(signedMethod),
    file,
    `the evidence bucket allows [${allowed.join(', ')}] but the API signs a ${signedMethod} ` +
      '(services/api/src/repositories/s3-presign-repository.ts) — S3 omits ' +
      'Access-Control-Allow-Origin for a method it does not allow, so every browser upload fails',
  );
}

check(
  corsRulesSeen === 0,
  join(infraRoot, 'modules'),
  'found no evidence-bucket CORS rule — the upload-method scan is not matching anything, which ' +
    'means it is no longer checking what it claims to check',
);

// --- GitHub AWS keys: no static AWS credentials in any workflow file. ---
const workflowsDir = join(root, '.github', 'workflows');
try {
  for (const entry of readdirSync(workflowsDir)) {
    const file = join(workflowsDir, entry);
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const content = readFileSync(file, 'utf8');
    check(
      /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(content),
      file,
      'references a static AWS access key in CI — must use GitHub Actions OIDC (role-to-assume) instead',
    );
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

if (findings.length > 0) {
  console.error('Terraform policy check found violations:');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Terraform policy check clean (${files.length} .tf files scanned).`);
