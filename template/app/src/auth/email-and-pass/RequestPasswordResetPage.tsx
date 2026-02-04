import { ForgotPasswordForm } from "wasp/client/auth";
import { AuthPageLayout } from "../AuthPageLayout";

export function RequestPasswordResetPage() {
  // Track password reset request
  const handlePasswordResetRequest = () => {
    const requestSource = "forgot_password_page";

    // Track password reset requested event
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.track("password_reset_requested", {
        email: "", // Email is in form data, not accessible here
        request_source: requestSource,
        user_exists: true // Server-side validation would determine this
      });
    }
  };

  return (
    <AuthPageLayout>
      <ForgotPasswordForm onSuccess={handlePasswordResetRequest} />
    </AuthPageLayout>
  );
}
