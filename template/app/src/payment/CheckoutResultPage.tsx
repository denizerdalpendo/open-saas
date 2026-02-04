import { useEffect } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

const ACCOUNT_PAGE_REDIRECT_DELAY_MS = 4000;

export default function CheckoutResultPage() {
  const navigate = useNavigate();
  const [urlSearchParams] = useSearchParams();
  const status = urlSearchParams.get("status");

  useEffect(() => {
    // Track checkout completion or cancellation
    if (status === "success" && typeof window !== 'undefined' && (window as any).pendo) {
      // Extract payment details from URL params if available
      const paymentPlanId = urlSearchParams.get("plan_id") || "";
      const transactionId = urlSearchParams.get("session_id") || "";

      (window as any).pendo.track("checkout_completed", {
        payment_plan_id: paymentPlanId,
        payment_plan_name: "", // Would need to map from planId
        plan_price: "", // Would need to map from planId
        is_subscription: true, // Would need to determine from planId
        payment_processor: "stripe", // Or detect based on configuration
        transaction_id: transactionId,
        is_first_purchase: false // Would need to determine from user history
      });
    } else if (status === "canceled" && typeof window !== 'undefined' && (window as any).pendo) {
      const paymentPlanId = urlSearchParams.get("plan_id") || "";

      (window as any).pendo.track("checkout_canceled", {
        payment_plan_id: paymentPlanId,
        payment_plan_name: "", // Would need to map from planId
        plan_price: "", // Would need to map from planId
        time_in_checkout: 0, // Would need to track from initiation
        cancellation_stage: "payment_page"
      });
    }

    const accountPageRedirectTimeoutId = setTimeout(() => {
      navigate("/account");
    }, ACCOUNT_PAGE_REDIRECT_DELAY_MS);

    return () => {
      clearTimeout(accountPageRedirectTimeoutId);
    };
  }, [status, urlSearchParams]);

  if (status !== "success" && status !== "canceled") {
    return <Navigate to="/account" />;
  }

  return (
    <div className="mt-10 flex flex-col items-stretch sm:mx-6 sm:items-center">
      <div className="flex flex-col gap-4 px-4 py-8 text-center shadow-xl ring-1 ring-gray-900/10 sm:max-w-md sm:rounded-lg sm:px-10 dark:ring-gray-100/10">
        <h1 className="text-xl font-semibold">
          {status === "success" && "🥳 Payment Successful!"}
          {status === "canceled" && "😢 Payment Canceled."}
        </h1>
        <span className="">
          You will be redirected to your account page in{" "}
          {ACCOUNT_PAGE_REDIRECT_DELAY_MS / 1000} seconds...
        </span>
      </div>
    </div>
  );
}
