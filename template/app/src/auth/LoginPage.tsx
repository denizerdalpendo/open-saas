import { LoginForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export default function Login() {
  // Track successful login
  const handleLoginSuccess = () => {
    const loginMethod = "email"; // Default method
    const deviceType = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop";

    // Track user login event
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track("user_logged_in", {
        login_method: loginMethod,
        auth_provider: loginMethod,
        days_since_last_login: 0, // Could be calculated server-side
        device_type: deviceType
      });
    }
  };

  return (
    <AuthPageLayout>
      <LoginForm onSuccess={handleLoginSuccess} />
      <br />
      <span className="text-sm font-medium text-gray-900 dark:text-gray-900">
        Don't have an account yet?{" "}
        <WaspRouterLink to={routes.SignupRoute.to} className="underline">
          go to signup
        </WaspRouterLink>
        .
      </span>
      <br />
      <span className="text-sm font-medium text-gray-900">
        Forgot your password?{" "}
        <WaspRouterLink
          to={routes.RequestPasswordResetRoute.to}
          className="underline"
        >
          reset it
        </WaspRouterLink>
        .
      </span>
    </AuthPageLayout>
  );
}
