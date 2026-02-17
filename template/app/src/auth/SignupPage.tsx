import { SignupForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export function Signup() {
  // Track user signup completed event
  // Note: Wasp's SignupForm doesn't expose an onSuccess callback directly.
  // To track this event, you would need to:
  // 1. Create a custom signup form that wraps Wasp's signup logic
  // 2. Use Wasp's auth hooks if available
  // 3. Track the event on the account page after redirect
  // 4. Add tracking to the server-side signup action

  return (
    <AuthPageLayout>
      <SignupForm
        onSuccess={(user: any) => {
          // Track signup completed event
          if (typeof window !== 'undefined' && (window as any).pendo) {
            (window as any).pendo.track("user_signup_completed", {
              user_id: user?.id,
              email: user?.email,
              signup_method: "email",
              referral_source: document.referrer || "direct",
              has_username: !!user?.username
            });
          }
        }}
      />
      <br />
      <span className="text-sm font-medium text-gray-900">
        I already have an account (
        <WaspRouterLink to={routes.LoginRoute.to} className="underline">
          go to login
        </WaspRouterLink>
        ).
      </span>
      <br />
    </AuthPageLayout>
  );
}
