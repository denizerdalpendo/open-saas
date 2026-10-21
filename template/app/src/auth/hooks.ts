import type { User } from "wasp/entities";
import type {
  OnAfterEmailVerifiedHook,
  OnAfterSignupHook,
} from "wasp/server/auth";
import { trackPendoServerEvent } from "../analytics/pendo";

// Wasp calls this once an account is actually created, for every auth method
// (email signups as well as OAuth redirects).
export const onAfterSignup: OnAfterSignupHook = async ({
  providerId,
  user,
}) => {
  await trackPendoServerEvent("user_signed_up", user.id, {
    auth_provider: providerId.providerName,
    is_admin: user.isAdmin,
    initial_credits: user.credits,
  });
};

// Opening a still-valid verification link again (e.g. refreshing the
// verification page) verifies the email, and calls this hook, again.
// We remember (per server process) who we already reported, so the milestone
// is only sent once.
const usersReportedAsEmailVerified = new Set<User["id"]>();

export const onAfterEmailVerified: OnAfterEmailVerifiedHook = async ({
  user,
}) => {
  if (usersReportedAsEmailVerified.has(user.id)) {
    return;
  }
  usersReportedAsEmailVerified.add(user.id);

  await trackPendoServerEvent("email_verified", user.id, {
    minutes_since_signup: Math.round(
      (Date.now() - user.createdAt.getTime()) / (60 * 1000),
    ),
  });
};
