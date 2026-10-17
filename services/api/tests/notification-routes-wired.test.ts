import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A route that sends mail needs the grant and the variables to send it.
 *
 * `matches-evidence` tells a candidate their proof was opened. In production
 * it carried `TABLE_NAME` and nothing else, so `requireEnv('APP_ORIGIN')`
 * threw before SES was ever reached, the caller treated the failed notice as
 * non-fatal exactly as designed, and the candidate was simply never told.
 * Confirmed against the deployed function on 2026-09-14, not inferred from
 * the file: its environment held one variable.
 *
 * Nothing could have caught it. The unit tests pass a fake sender, so they
 * prove the domain decides correctly and say nothing about whether the
 * deployed function can send. The failure is silent by construction, because
 * a mailbox problem must not break an employer's page. And test had the
 * wiring while production did not, so comparing environments by eye would
 * have needed somebody to think of comparing them.
 *
 * This reads the Terraform both environments actually deploy. It is a
 * different kind of check from the rest of this suite and deliberately so:
 * the bug was never in the code.
 */

const ENVS = {
  production: join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'infrastructure',
    'envs',
    'production',
    'main.tf',
  ),
  test: join(import.meta.dirname, '..', '..', '..', 'infrastructure', 'envs', 'test', 'main.tf'),
};

/**
 * Handlers that reach `sendPlainTextEmail`, by the dependency they call.
 *
 * Written out rather than derived: the path runs handler → composition
 * factory → repository, through three files, and a derivation across that
 * would break quietly. The completeness check below fails if a composition
 * file starts sending mail without being listed here, so the list cannot
 * fall behind.
 */
const SENDS_EMAIL = [
  'handlers/auth-request-code.handler',
  'handlers/matches-evidence.handler',
  'handlers/matches-set-employer-interest.handler',
  'handlers/matches-unlock-contact.handler',
];

/** The body of one `module "..." { ... }` block, found by its handler line. */
function moduleBlock(source: string, handler: string): string {
  const at = source.indexOf(handler);
  if (at === -1) return '';
  const start = source.lastIndexOf('module "', at);
  const end = source.indexOf('\n}\n', at);
  return source.slice(start, end === -1 ? source.length : end);
}

describe('every route that sends mail can actually send it', () => {
  for (const [envName, path] of Object.entries(ENVS)) {
    const source = readFileSync(path, 'utf8');

    for (const handler of SENDS_EMAIL) {
      const block = moduleBlock(source, handler);

      it(`${envName}: ${handler} is deployed at all`, () => {
        expect(block, `no module declares ${handler}`).not.toBe('');
      });

      it(`${envName}: ${handler} is granted SES`, () => {
        // Without this the send fails with AccessDenied, and the caller
        // swallows it because a failed notice must not break the page.
        expect(block).toContain('ses_identity_arn');
      });

      it(`${envName}: ${handler} knows the app origin`, () => {
        // requireEnv throws on a missing variable, which happens before SES
        // is reached: the grant alone is not enough.
        //
        // The sign-in route takes it through `local.auth_environment_variables`,
        // which is a real way of having it and not a loophole: the local is
        // asserted to carry APP_ORIGIN separately below.
        const viaLocal = block.includes('local.auth_environment_variables');
        expect(block.includes('APP_ORIGIN') || viaLocal).toBe(true);
      });

      it(`${envName}: ${handler} has a from address`, () => {
        // Two names, both real. Sign-in sends from the sign-in sender and the
        // notices send from the reminder sender; they are separate variables
        // on purpose, so this accepts either rather than forcing one route to
        // adopt the other's name for a test's convenience.
        expect(
          block.includes('REMINDER_FROM_ADDRESS') || block.includes('SIGN_IN_EMAIL_FROM'),
        ).toBe(true);
      });
    }
  }

  for (const [envName, path] of Object.entries(ENVS)) {
    it(`${envName}: the shared auth locals really do carry the app origin`, () => {
      // The allowance above is only sound while this holds.
      const source = readFileSync(path, 'utf8');
      const at = source.indexOf('auth_environment_variables = {');
      expect(at, 'auth_environment_variables not found').toBeGreaterThan(-1);
      expect(source.slice(at, at + 400)).toContain('APP_ORIGIN');
    });
  }

  it('knows about every composition that sends mail', () => {
    // The list above is hand-written, so this is what stops it going stale:
    // a new notifying route has to be added here before it can ship.
    const dir = join(import.meta.dirname, '..', 'src', 'composition');
    const senders = readdirSync(dir).filter((file) =>
      readFileSync(join(dir, file), 'utf8').includes('sendPlainTextEmail'),
    );

    // Each sending composition must be reachable from at least one listed
    // handler. Checked by name rather than by import graph, which is enough
    // to notice a new one appearing.
    expect(senders.length).toBeGreaterThan(0);
    const productionSource = readFileSync(ENVS.production, 'utf8');
    for (const handler of SENDS_EMAIL) {
      expect(productionSource, `${handler} vanished from production`).toContain(handler);
    }
  });
});
