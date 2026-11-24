import { type Prisma } from "@prisma/client";
import type { User } from "wasp/entities";
import type { PrismaClient } from "wasp/server";
import { sendPendoTrackEvent } from "../server/pendo";
import type { PaymentProcessor } from "./paymentProcessor";
import { PaymentPlanId, paymentPlans, SubscriptionStatus } from "./plans";

type PaymentProcessorId = PaymentProcessor["id"];

export type UserSubscriptionState = Pick<
  User,
  "subscriptionStatus" | "subscriptionPlan"
>;

/**
 * Fetches the user's current subscription state, so that it can be compared
 * with the state after a webhook update (see `trackSubscriptionStatusChanged`).
 */
export function fetchUserSubscriptionState(
  where: Prisma.UserWhereUniqueInput,
  prismaUserDelegate: PrismaClient["user"],
): Promise<UserSubscriptionState | null> {
  return prismaUserDelegate.findUnique({
    where,
    select: { subscriptionStatus: true, subscriptionPlan: true },
  });
}

/**
 * Pendo Track Event: `payment_completed`.
 * Fires when the payment processor confirms a payment (one-time credits purchase or subscription payment).
 */
export async function trackPaymentCompleted({
  user,
  paymentPlanId,
  paymentProcessor,
  datePaid,
}: {
  user: Pick<User, "id">;
  paymentPlanId: PaymentPlanId;
  paymentProcessor: PaymentProcessorId;
  datePaid?: Date;
}): Promise<void> {
  const planEffect = paymentPlans[paymentPlanId].effect;

  await sendPendoTrackEvent({
    event: "payment_completed",
    visitorId: user.id,
    properties: {
      payment_plan_id: paymentPlanId,
      plan_type: planEffect.kind,
      credits_purchased: planEffect.kind === "credits" ? planEffect.amount : 0,
      payment_processor: paymentProcessor,
      date_paid: datePaid?.toISOString(),
    },
  });
}

/**
 * Pendo Track Event: `subscription_status_changed`.
 * Fires when a subscription webhook changes the user's subscription status or plan
 * (e.g. cancel at period end, past due, deleted, or a plan change).
 *
 * Webhooks can be delivered more than once, and some of them (e.g. Stripe's
 * `customer.subscription.updated`) also fire for changes unrelated to status or plan,
 * so the event is only sent when the status or plan actually changed.
 */
export async function trackSubscriptionStatusChanged({
  previousState,
  user,
  paymentProcessor,
}: {
  previousState: UserSubscriptionState | null;
  user: Pick<User, "id" | "subscriptionStatus" | "subscriptionPlan">;
  paymentProcessor: PaymentProcessorId;
}): Promise<void> {
  if (
    previousState?.subscriptionStatus === user.subscriptionStatus &&
    previousState?.subscriptionPlan === user.subscriptionPlan
  ) {
    return;
  }

  await sendPendoTrackEvent({
    event: "subscription_status_changed",
    visitorId: user.id,
    properties: {
      subscription_status: user.subscriptionStatus,
      previous_subscription_status: previousState?.subscriptionStatus,
      payment_plan_id: user.subscriptionPlan,
      cancel_at_period_end:
        user.subscriptionStatus === SubscriptionStatus.CancelAtPeriodEnd,
      payment_processor: paymentProcessor,
    },
  });
}
