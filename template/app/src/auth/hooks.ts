import type {
  OnAfterEmailVerifiedHook,
  OnAfterLoginHook,
  OnAfterSignupHook,
} from "wasp/server/auth";
import { trackPendoServerEvent } from "../server/pendo";

// These hooks send Pendo Track Events from the server, because Wasp's auth
// forms and OAuth redirects have no client-side success callbacks.
// The events aren't awaited, so a slow Pendo response never delays signup,
// email verification or login.

export const onAfterSignup: OnAfterSignupHook = ({ providerId, user }) => {
  void trackPendoServerEvent({
    event: "user_signed_up",
    visitorId: user.id,
    properties: {
      authMethod: providerId.providerName,
      isAdmin: user.isAdmin,
      initialCredits: user.credits,
      emailVerificationRequired: providerId.providerName === "email",
    },
  });
};

export const onAfterEmailVerified: OnAfterEmailVerifiedHook = ({ user }) => {
  void trackPendoServerEvent({
    event: "email_verified",
    visitorId: user.id,
    properties: {
      authMethod: "email",
      minutesSinceSignup: Math.round(
        (Date.now() - user.createdAt.getTime()) / (1000 * 60),
      ),
    },
  });
};

export const onAfterLogin: OnAfterLoginHook = ({ providerId, user }) => {
  void trackPendoServerEvent({
    event: "user_logged_in",
    visitorId: user.id,
    properties: {
      authMethod: providerId.providerName,
      isAdmin: user.isAdmin,
      subscriptionStatus: user.subscriptionStatus ?? "none",
      subscriptionPlan: user.subscriptionPlan ?? "free",
      credits: user.credits,
    },
  });
};
