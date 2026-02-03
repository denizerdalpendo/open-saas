import { ForgotPasswordForm } from "wasp/client/auth";
import { AuthPageLayout } from "../AuthPageLayout";

export function RequestPasswordResetPage() {
  // Track password reset requested event
  // Note: Similar to signup/login, Wasp's ForgotPasswordForm may not expose callbacks.
  // The event tracking should be added when available via Wasp's form props.

  return (
    <AuthPageLayout>
      <ForgotPasswordForm
        onSuccess={(data: any) => {
          // Track password reset requested event
          if (typeof window !== 'undefined' && (window as any).pendo) {
            (window as any).pendo.track("password_reset_requested", {
              user_id: data?.userId || "unknown",
              email: data?.email || "unknown",
              request_source: "forgot_password_page"
            });
          }
        }}
      />
    </AuthPageLayout>
  );
}
