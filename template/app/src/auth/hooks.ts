import type { OnAfterSignupHook } from "wasp/server/auth";
import { sendPendoTrackEvent } from "../server/pendo";

export const onAfterSignup: OnAfterSignupHook = async ({
  providerId,
  user,
}) => {
  // Pendo Track Event: `signup_completed`.
  // Fires once, when a new account is created. Login and signup both redirect to the same
  // page, so this is the only way to tell new signups apart from returning logins.
  await sendPendoTrackEvent({
    event: "signup_completed",
    visitorId: user.id,
    properties: {
      auth_provider: providerId.providerName,
      is_admin: user.isAdmin,
      email_verification_required: providerId.providerName === "email",
    },
  });
};
