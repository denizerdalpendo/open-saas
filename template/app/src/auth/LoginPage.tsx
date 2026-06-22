import { LoginForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export default function Login() {
  // Track user login completed event
  // Note: Similar to signup, Wasp's LoginForm may not expose an onSuccess callback.
  // See comment in SignupPage.tsx for tracking options.

  return (
    <AuthPageLayout>
      <LoginForm
        onSuccess={(user: any) => {
          // Track login completed event
          if (typeof window !== 'undefined' && (window as any).pendo) {
            const lastLoginKey = `last_login_${user?.id}`;
            const lastLogin = localStorage.getItem(lastLoginKey);
            const now = new Date();
            let daysSinceLastLogin = 0;

            if (lastLogin) {
              const lastLoginDate = new Date(lastLogin);
              daysSinceLastLogin = Math.floor((now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24));
            }

            (window as any).pendo.track("user_login_completed", {
              user_id: user?.id,
              email: user?.email,
              login_method: "email",
              is_returning_user: !!lastLogin,
              days_since_last_login: daysSinceLastLogin
            });

            localStorage.setItem(lastLoginKey, now.toISOString());
          }
        }}
      />
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
