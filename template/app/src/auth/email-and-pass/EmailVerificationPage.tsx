import { VerifyEmailForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "../AuthPageLayout";

export function EmailVerificationPage() {
  // Track successful email verification
  const handleVerificationSuccess = () => {
    // Extract email provider from user's email if available
    const emailProvider = "unknown"; // Could be extracted from user email

    // Track email verification completion
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track("email_verification_completed", {
        time_to_verify: 0, // Would need to calculate from signup timestamp
        verification_attempts: 1, // Default to 1
        email_provider: emailProvider
      });
    }
  };

  return (
    <AuthPageLayout>
      <VerifyEmailForm onSuccess={handleVerificationSuccess} />
      <br />
      <span className="text-sm font-medium text-gray-900">
        If everything is okay,{" "}
        <WaspRouterLink to={routes.LoginRoute.to} className="underline">
          go to login
        </WaspRouterLink>
      </span>
    </AuthPageLayout>
  );
}
