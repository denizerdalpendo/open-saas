import { ResetPasswordForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "../AuthPageLayout";

export function PasswordResetPage() {
  // Track successful password reset
  const handlePasswordResetSuccess = () => {
    const resetMethod = "email_link";

    // Track password reset completed event
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track("password_reset_completed", {
        time_since_request: 0, // Would need to calculate from request timestamp
        reset_method: resetMethod
      });
    }
  };

  return (
    <AuthPageLayout>
      <ResetPasswordForm onSuccess={handlePasswordResetSuccess} />
      <br />
      <span className="text-sm font-medium text-gray-900">
        If everything is okay,{" "}
        <WaspRouterLink to={routes.LoginRoute.to}>go to login</WaspRouterLink>
      </span>
    </AuthPageLayout>
  );
}
