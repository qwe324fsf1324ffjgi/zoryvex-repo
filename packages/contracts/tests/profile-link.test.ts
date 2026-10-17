import { describe, expect, it } from 'vitest';
import { LinkedInUrlSchema, ProfileLinkSchema } from '../src/domain';

/**
 * The link field that is deliberately not pinned to a host.
 *
 * `LinkedInUrlSchema` accepts one host because a field claiming to be a
 * LinkedIn profile should be one. This field makes the opposite promise: it
 * is for wherever else somebody's work lives, so the host cannot be the
 * thing being checked. What is checked instead is the small set of shapes
 * that make a link dangerous rather than merely unfamiliar, and these tests
 * are that list.
 */

describe('a link a candidate can give', () => {
  it.each([
    'https://github.com/some-person',
    'https://gitlab.com/some-person',
    'https://some-person.dev',
    'https://blog.example.co.uk/about',
    'https://x.com/some-person',
  ])('accepts %s', (url) => {
    expect(ProfileLinkSchema.safeParse(url).success).toBe(true);
  });

  /**
   * http is rejected rather than upgraded. Silently rewriting somebody's
   * input to a different address than the one they typed is the wrong kind
   * of helpful on a field an employer will click.
   */
  it('refuses plain http', () => {
    expect(ProfileLinkSchema.safeParse('http://github.com/some-person').success).toBe(false);
  });

  /**
   * user:password@host is how a link is made to look like it goes somewhere
   * it does not. It is the one shape here that is an attack rather than a
   * mistake.
   */
  it('refuses embedded credentials', () => {
    const parsed = ProfileLinkSchema.safeParse('https://github.com@evil.example/some-person');
    expect(parsed.success).toBe(false);
  });

  it.each([
    ['not a url at all', 'just some words'],
    ['a bare host with no scheme', 'github.com/some-person'],
    ['a host with no dot', 'https://localhost/some-person'],
    ['javascript', 'javascript:alert(1)'],
  ])('refuses %s', (_why, value) => {
    expect(ProfileLinkSchema.safeParse(value).success).toBe(false);
  });

  it('refuses something absurdly long', () => {
    expect(ProfileLinkSchema.safeParse(`https://example.com/${'a'.repeat(300)}`).success).toBe(
      false,
    );
  });

  it('trims surrounding whitespace rather than refusing a pasted value', () => {
    const parsed = ProfileLinkSchema.safeParse('  https://github.com/some-person  ');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('https://github.com/some-person');
  });

  /**
   * The two fields keep their different jobs. If this ever passes, the
   * LinkedIn field has quietly become a general link field and the label on
   * it has started lying.
   */
  it('does not make the LinkedIn field accept anything', () => {
    expect(LinkedInUrlSchema.safeParse('https://github.com/some-person').success).toBe(false);
    expect(LinkedInUrlSchema.safeParse('https://www.linkedin.com/in/some-person').success).toBe(
      true,
    );
  });
});
