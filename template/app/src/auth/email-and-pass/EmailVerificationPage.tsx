import { VerifyEmailForm } from "wasp/client/auth";
import { Link as WaspRouterLink, routes } from "wasp/client/router";
import { AuthPageLayout } from "../AuthPageLayout";

export function EmailVerificationPage() {
  return (
    <AuthPageLayout>
      <VerifyEmailForm
        onSuccess={(data: any) => {
          // Track email verification completed event
          if (typeof window !== 'undefined' && (window as any).pendo) {
            const verificationStartTime = localStorage.getItem('verification_start_time');
            let timeToVerifyMinutes = 0;

            if (verificationStartTime) {
              const now = new Date();
              const startTime = new Date(verificationStartTime);
              timeToVerifyMinutes = Math.round((now.getTime() - startTime.getTime()) / (1000 * 60));
              localStorage.removeItem('verification_start_time');
            }

            (window as any).pendo.track("email_verification_completed", {
              user_id: data?.userId || "unknown",
              email: data?.email || "unknown",
              time_to_verify_minutes: timeToVerifyMinutes
            });
          }
        }}
      />
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
