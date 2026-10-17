import { z } from 'zod';
import {
  CandidateIntentSchema,
  CandidateLocationSchema,
  LaunchTrackSchema,
  LinkedInUrlSchema,
  ProfileLinkSchema,
  PhoneSchema,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { updateOwnCandidateProfile } from '../../src/domain/candidate-profile-service';
import { createAwsCandidateProfileDependencies } from '../../src/composition/aws-candidate-profile-dependencies';

const UpdateProfileSchema = z.object({
  version: z.number().int().nonnegative(),
  displayName: z.string().min(1).max(TEXT_LIMITS.displayName).optional(),
  launchTrack: LaunchTrackSchema.optional(),
  summary: z.string().max(TEXT_LIMITS.summary).optional(),
  onboardingComplete: z.boolean().optional(),
  // Nullable so a candidate can withdraw it. Withdrawing costs them nothing:
  // an unstated location is never filtered against.
  location: CandidateLocationSchema.nullable().optional(),
  // Nullable so a candidate can take a channel back down. Validated to the
  // same shapes the profile form validates against, because a client is not
  // a validator: the form can be bypassed, and a stored value that is not a
  // phone number or not a LinkedIn profile would be shown to an employer as
  // though it were.
  phone: PhoneSchema.nullable().optional(),
  linkedinUrl: LinkedInUrlSchema.nullable().optional(),
  websiteUrl: ProfileLinkSchema.nullable().optional(),
  // What kind of work they are open to and what they need to be paid.
  // Nullable so it can be withdrawn: an unstated preference is never held
  // against them, so taking it back is free, which is the property that
  // makes stating it safe in the first place.
  intent: CandidateIntentSchema.nullable().optional(),
  // A file id the candidate already uploaded, or null to take the photo
  // down. The shape is all that is checked here; whether that file is
  // theirs, scanned clean and actually an image is decided in the domain,
  // against the stored record.
});

const deps = createAwsCandidateProfileDependencies();

/** Never accepts discoveryOptIn/contactUnlockConsent — see candidate-profile-service.ts. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const { version, ...patch } = validateRequest(UpdateProfileSchema, parseJsonBody(event.body));
    return updateOwnCandidateProfile(session.candidateId, version, patch, deps);
  });
