import { useEffect } from "react";
import { SignupForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "./AuthPageLayout";

export function Signup() {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track('SignupPageViewed');
    }
  }, []);

  return (
    <AuthPageLayout>
      <SignupForm />
      <br />
      <span className="text-sm font-medium text-gray-900">
        I already have an account (
        <WaspRouterLink
          to={routes.LoginRoute.to}
          className="underline"
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).pendo) {
              (window as any).pendo.track('GoToLoginClicked');
            }
          }}
        >
          go to login
        </WaspRouterLink>
        ).
      </span>
      <br />
    </AuthPageLayout>
  );
}
