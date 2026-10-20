import type { OnAfterSignupHook } from "wasp/server/auth";
import { sendPendoTrackEvent } from "../server/pendo";

export const onAfterSignup: OnAfterSignupHook = ({ providerId, user }) => {
  // Signup happens through Wasp's built-in auth forms and OAuth flows, which have no
  // client-side success callback, so we track it here for the newly created user.
  // Not awaited, so that tracking doesn't delay the signup response.
  void sendPendoTrackEvent({
    event: "user_signed_up",
    visitorId: user.id,
    properties: {
      providerName: providerId.providerName,
      isAdmin: user.isAdmin,
      credits: user.credits,
      createdAt: user.createdAt.toISOString(),
    },
  });
};
