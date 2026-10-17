// Compares the feature flags a Terraform environment *declares* against the
// ones its Parameter Store document actually holds.
//
// This exists because the gap between those two is invisible by design.
// `aws_ssm_parameter.feature_flags` carries `ignore_changes = [value]` in
// every environment, deliberately: scripts/emergency-cost-lockdown.mjs
// rewrites that document during an incident, and a later `terraform apply`
// must never quietly undo it. The cost of that choice is that Terraform
// stops reporting the difference — a plan says nothing, an apply changes
// nothing, and the live flags can say whatever they like indefinitely.
//
// That has already happened here twice. Once as `aiMatching: true` standing
// live for roughly four days against a repository that says it stays off
// until the evaluation gate passes, found only because somebody went
// looking. Once as `payments: false` live against a TEST environment whose
// Terraform declares it true, which is the difference between a Kit
// checkout working and returning a refusal.
//
// Everything here is pure. The AWS read lives in
// scripts/check-feature-flags.mjs.

/**
 * Pulls the declared flags out of an environment's main.tf.
 *
 * The grammar is deliberately narrow — `key = true` / `key = false` inside
 * the one `jsonencode({...})` on `aws_ssm_parameter.feature_flags`. Anything
 * else (a variable, an expression, a nested object) is not something this
 * should quietly half-understand, so it throws rather than guess.
 */
export function parseDeclaredFlags(source) {
  const resourceStart = source.indexOf('resource "aws_ssm_parameter" "feature_flags"');
  if (resourceStart === -1) {
    throw new Error('No aws_ssm_parameter.feature_flags resource found in this main.tf.');
  }

  const jsonEncodeStart = source.indexOf('jsonencode({', resourceStart);
  if (jsonEncodeStart === -1) {
    throw new Error(
      'aws_ssm_parameter.feature_flags does not set its value with jsonencode({...}); ' +
        'this parser only understands that form.',
    );
  }

  const bodyStart = jsonEncodeStart + 'jsonencode({'.length;
  const bodyEnd = source.indexOf('})', bodyStart);
  if (bodyEnd === -1) throw new Error('Unterminated jsonencode({...}) on feature_flags.');

  const body = source.slice(bodyStart, bodyEnd);
  const flags = {};
  for (const match of body.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*=\s*(true|false)\b/g)) {
    flags[match[1]] = match[2] === 'true';
  }

  const stripped = body
    .replace(/([A-Za-z][A-Za-z0-9_]*)\s*=\s*(true|false)\b/g, '')
    .replace(/[\s,]/g, '');
  if (stripped.length > 0) {
    throw new Error(
      `feature_flags declares something other than plain booleans (${stripped}); refusing to guess at it.`,
    );
  }
  if (Object.keys(flags).length === 0) {
    throw new Error('feature_flags declares no flags at all.');
  }

  return flags;
}

/**
 * @param declared   what the environment's Terraform says the flags are
 * @param live       what the Parameter Store document actually holds
 * @param schemaKeys every key FeatureFlagsSchema defines
 */
export function compareFeatureFlags({ declared, live, schemaKeys }) {
  const keys = [...schemaKeys];

  // FeatureFlagsSchema is .strict(), and getFeatureFlags falls back to
  // DEFAULT_FEATURE_FLAGS (every flag false) when parsing fails. So one
  // stray key in the live document does not disable that key — it disables
  // every flag in the system, silently, with no error anywhere. That is the
  // single worst state this document can be in, and nothing else reports it.
  const unknownLiveKeys = Object.keys(live).filter((k) => !keys.includes(k));

  const missingLiveKeys = keys.filter((k) => !(k in live));
  const declaredMissingKeys = keys.filter((k) => !(k in declared));

  const enabledBeyondDeclared = [];
  const disabledBelowDeclared = [];
  for (const key of keys) {
    const liveValue = live[key] ?? false;
    const declaredValue = declared[key] ?? false;
    if (liveValue && !declaredValue) enabledBeyondDeclared.push(key);
    if (!liveValue && declaredValue) disabledBelowDeclared.push(key);
  }

  return {
    unknownLiveKeys,
    missingLiveKeys,
    declaredMissingKeys,
    enabledBeyondDeclared,
    disabledBelowDeclared,
    // True when the live document cannot be parsed at all, so every flag in
    // the running system is false regardless of what it appears to say.
    everythingSilentlyOff: unknownLiveKeys.length > 0,
  };
}

export function hasFeatureFlagDrift(result) {
  return (
    result.unknownLiveKeys.length > 0 ||
    result.missingLiveKeys.length > 0 ||
    result.declaredMissingKeys.length > 0 ||
    result.enabledBeyondDeclared.length > 0 ||
    result.disabledBelowDeclared.length > 0
  );
}

/**
 * True for the direction that is never a legitimate out-of-band edit. The
 * lockdown script only ever turns flags off, so a flag that is on live and
 * off in Terraform was not put there by any process this repository owns.
 */
export function hasUnsafeFeatureFlagDrift(result) {
  return result.enabledBeyondDeclared.length > 0 || result.unknownLiveKeys.length > 0;
}

export function describeFeatureFlagDrift(result, { environment }) {
  if (!hasFeatureFlagDrift(result)) {
    return `Feature flags in ${environment} match what Terraform declares.`;
  }

  const lines = [`Feature-flag drift in ${environment}:`];

  if (result.unknownLiveKeys.length > 0) {
    lines.push(
      `  Unknown keys in the live document: ${result.unknownLiveKeys.join(', ')}.`,
      '    FeatureFlagsSchema is strict, so the whole document fails to parse and every',
      '    flag in the running system reads as false, including the ones that look on.',
    );
  }
  if (result.enabledBeyondDeclared.length > 0) {
    lines.push(
      `  On live, off in Terraform: ${result.enabledBeyondDeclared.join(', ')}.`,
      '    Nothing this repository runs turns a flag on out of band, so this was a',
      '    manual edit that the repository never agreed to.',
    );
  }
  if (result.disabledBelowDeclared.length > 0) {
    lines.push(
      `  Off live, on in Terraform: ${result.disabledBelowDeclared.join(', ')}.`,
      '    Expected during an emergency lockdown, and expected before a deliberate',
      '    enable that has not been done yet. Not expected otherwise.',
    );
  }
  if (result.missingLiveKeys.length > 0) {
    lines.push(
      `  Absent from the live document: ${result.missingLiveKeys.join(', ')}.`,
      '    These read as false through the schema default rather than erroring.',
    );
  }
  if (result.declaredMissingKeys.length > 0) {
    lines.push(
      `  In the schema but not declared in Terraform: ${result.declaredMissingKeys.join(', ')}.`,
      '    A new environment would be created without them.',
    );
  }

  return lines.join('\n');
}
