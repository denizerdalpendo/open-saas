import type { OnAfterSignupHook } from "wasp/server/auth";
import { sendPendoTrackEvent } from "../server/pendo";

export const onAfterSignup: OnAfterSignupHook = async ({
  providerId,
  user,
}) => {
  // Tracked on the server because Wasp's `<SignupForm />` has no success callback,
  // OAuth sign-ups skip the form, and at this point the browser is still on the
  // anonymous Pendo visitor (users who never verify their email are never identified).
  await sendPendoTrackEvent("user_signed_up", user.id, {
    auth_provider: providerId.providerName,
    is_admin: user.isAdmin,
    initial_credits: user.credits,
  });
};
