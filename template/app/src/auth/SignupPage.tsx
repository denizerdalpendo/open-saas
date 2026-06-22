import { SignupForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export function Signup() {
  // Track successful signup
  const handleSignupSuccess = () => {
    // Get user data from the form submission context
    const signupMethod = "email"; // Default method, could be detected from form
    const emailDomain = ""; // Will be populated from form data if available

    // Track user signup event
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track("user_signed_up", {
        signup_method: signupMethod,
        auth_provider: signupMethod,
        is_admin: false, // Will be set server-side
        email_domain: emailDomain,
        referrer_source: document.referrer || "direct"
      });
    }
  };

  return (
    <AuthPageLayout>
      <SignupForm onSuccess={handleSignupSuccess} />
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
