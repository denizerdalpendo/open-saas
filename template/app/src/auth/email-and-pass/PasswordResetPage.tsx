import { ResetPasswordForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "../AuthPageLayout";

export function PasswordResetPage() {
  return (
    <AuthPageLayout>
      <ResetPasswordForm
        onSuccess={(data: any) => {
          // Track password reset completed event
          if (typeof window !== 'undefined' && (window as any).pendo) {
            (window as any).pendo.track("password_reset_completed", {
              user_id: data?.userId || "unknown",
              email: data?.email || "unknown"
            });
          }
        }}
      />
      <br />
      <span className="text-sm font-medium text-gray-900">
        If everything is okay,{" "}
        <WaspRouterLink to={routes.LoginRoute.to}>go to login</WaspRouterLink>
      </span>
    </AuthPageLayout>
  );
}
