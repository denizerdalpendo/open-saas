import { useEffect } from "react";
import { LoginForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export default function Login() {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track('LoginPageViewed');
    }
  }, []);

  return (
    <AuthPageLayout>
      <LoginForm />
      <br />
      <span className="text-sm font-medium text-gray-900 dark:text-gray-900">
        Don't have an account yet?{" "}
        <WaspRouterLink
          to={routes.SignupRoute.to}
          className="underline"
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).pendo) {
              (window as any).pendo.track('GoToSignupClicked');
            }
          }}
        >
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
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).pendo) {
              (window as any).pendo.track('ForgotPasswordClicked');
            }
          }}
        >
          reset it
        </WaspRouterLink>
        .
      </span>
    </AuthPageLayout>
  );
}
