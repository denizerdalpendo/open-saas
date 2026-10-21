import { type PrismaClient } from "@prisma/client";
import express from "express";
import type { Stripe } from "stripe";
import type { User } from "wasp/entities";
import { type MiddlewareConfigFn } from "wasp/server";
import { type PaymentsWebhook } from "wasp/server/api";
import { emailSender } from "wasp/server/email";
import { trackPendoServerEvent } from "../../analytics/pendo";
import { requireNodeEnvVar } from "../../server/utils";
import { assertUnreachable } from "../../shared/utils";
import { UnhandledWebhookEventError } from "../errors";
import {
  getPaymentPlanIdByPaymentProcessorPlanId,
  PaymentPlanId,
  paymentPlans,
  SubscriptionStatus,
} from "../plans";
import { updateUserCredits, updateUserSubscription } from "../user";
import { stripeClient } from "./stripeClient";

/**
 * Stripe requires a raw request to construct events successfully.
 */
export const stripeMiddlewareConfigFn: MiddlewareConfigFn = (
  middlewareConfig,
) => {
  middlewareConfig.delete("express.json");
  middlewareConfig.set(
    "express.raw",
    express.raw({ type: "application/json" }),
  );
  return middlewareConfig;
};

export const stripeWebhook: PaymentsWebhook = async (
  request,
  response,
  context,
) => {
  const prismaUserDelegate = context.entities.User;
  try {
    const event = constructStripeEvent(request);

    // If you'd like to handle more events, you can add more cases below.
    // When deploying your app, you configure your webhook in the Stripe dashboard
    // to only send the events that you're handling above.
    // See: https://docs.opensaas.sh/guides/deploying/#setting-up-your-stripe-webhook
    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(event, prismaUserDelegate);
        break;
      case "customer.subscription.updated":
        await handleCustomerSubscriptionUpdated(event, prismaUserDelegate);
        break;
      case "customer.subscription.deleted":
        await handleCustomerSubscriptionDeleted(event, prismaUserDelegate);
        break;
      default:
        throw new UnhandledWebhookEventError(event.type);
    }
    return response.status(204).send();
  } catch (error) {
    if (error instanceof UnhandledWebhookEventError) {
      // In development, it is likely that we will receive events that we are not handling.
      // E.g. via the `stripe trigger` command.
      if (process.env.NODE_ENV === "development") {
        console.info("Unhandled Stripe webhook event in development: ", error);
      } else if (process.env.NODE_ENV === "production") {
        console.error("Unhandled Stripe webhook event in production: ", error);
      }

      // We must return a 2XX status code, otherwise Stripe will keep retrying the event.
      return response.status(204).send();
    }

    console.error("Stripe webhook error:", error);
    if (error instanceof Error) {
      return response.status(400).json({ error: error.message });
    } else {
      return response
        .status(500)
        .json({ error: "Error processing Stripe webhook event" });
    }
  }
};

function constructStripeEvent(request: express.Request): Stripe.Event {
  const stripeWebhookSecret = requireNodeEnvVar("STRIPE_WEBHOOK_SECRET");
  const stripeSignature = request.headers["stripe-signature"];
  if (!stripeSignature) {
    throw new Error("Stripe webhook signature not provided");
  }

  return stripeClient.webhooks.constructEvent(
    request.body,
    stripeSignature,
    stripeWebhookSecret,
  );
}

async function handleInvoicePaid(
  event: Stripe.InvoicePaidEvent,
  prismaUserDelegate: PrismaClient["user"],
): Promise<void> {
  const invoice = event.data.object;
  const customerId = getCustomerId(invoice.customer);
  const invoicePaidAtDate = getInvoicePaidAtDate(invoice);
  const paymentPlanId = getPaymentPlanIdByPaymentProcessorPlanId(
    getInvoicePriceId(invoice),
  );

  switch (paymentPlanId) {
    case PaymentPlanId.Credits10: {
      const user = await updateUserCredits(
        {
          paymentProcessorUserId: customerId,
          datePaid: invoicePaidAtDate,
          numOfCreditsPurchased: paymentPlans[paymentPlanId].effect.amount,
        },
        prismaUserDelegate,
      );
      await trackPendoServerEvent("credits_purchased", user.id, {
        payment_plan_id: paymentPlanId,
        num_of_credits_purchased: paymentPlans[paymentPlanId].effect.amount,
        credits_balance: user.credits,
        // In the currency's smallest unit, e.g. cents.
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        payment_processor: "stripe",
      });
      break;
    }
    case PaymentPlanId.Pro:
    case PaymentPlanId.Hobby: {
      const user = await updateUserSubscription(
        {
          paymentProcessorUserId: customerId,
          datePaid: invoicePaidAtDate,
          paymentPlanId,
          subscriptionStatus: SubscriptionStatus.Active,
        },
        prismaUserDelegate,
      );
      await trackPendoServerEvent("subscription_payment_succeeded", user.id, {
        payment_plan_id: paymentPlanId,
        // e.g. `subscription_create` (new), `subscription_cycle` (renewal).
        billing_reason: invoice.billing_reason,
        // In the currency's smallest unit, e.g. cents.
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        date_paid: invoicePaidAtDate.toISOString(),
        payment_processor: "stripe",
      });
      break;
    }
    default:
      assertUnreachable(paymentPlanId);
  }
}

function getInvoicePriceId(invoice: Stripe.Invoice): Stripe.Price["id"] {
  const invoiceLineItems = invoice.lines.data;
  // We only expect one line item.
  // If your workflow expects more, you should change this function to handle them.
  if (invoiceLineItems.length !== 1) {
    throw new Error("There should be exactly one line item in Stripe invoice");
  }

  const priceId = invoiceLineItems[0].pricing?.price_details?.price;
  if (!priceId) {
    throw new Error("Unable to extract price id from items");
  }

  return priceId;
}

async function handleCustomerSubscriptionUpdated(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
  prismaUserDelegate: PrismaClient["user"],
): Promise<void> {
  const subscription = event.data.object;

  // There are other subscription statuses, such as `trialing` that we are not handling.
  const subscriptionStatus = getOpenSaasSubscriptionStatus(subscription);
  if (!subscriptionStatus) {
    return;
  }

  const customerId = getCustomerId(subscription.customer);
  const paymentPlanId = getPaymentPlanIdByPaymentProcessorPlanId(
    getSubscriptionPriceId(subscription),
  );

  const user = await updateUserSubscription(
    { paymentProcessorUserId: customerId, paymentPlanId, subscriptionStatus },
    prismaUserDelegate,
  );

  await trackSubscriptionUpdatedEvents(
    event,
    user.id,
    paymentPlanId,
    subscriptionStatus,
  );

  if (subscription.cancel_at_period_end && user.email) {
    await emailSender.send({
      to: user.email,
      subject: "We hate to see you go :(",
      text: "We hate to see you go. Here is a sweet offer...",
      html: "We hate to see you go. Here is a sweet offer...",
    });
  }
}

/**
 * Stripe sends `customer.subscription.updated` for many changes (e.g. every
 * renewal), and keeps sending it while e.g. a cancellation is pending. So we
 * only track transitions, based on `previous_attributes`, which only contains
 * the fields that changed with this event.
 */
async function trackSubscriptionUpdatedEvents(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
  userId: User["id"],
  paymentPlanId: PaymentPlanId,
  subscriptionStatus: SubscriptionStatus,
): Promise<void> {
  const subscription = event.data.object;
  const previousAttributes = event.data.previous_attributes;

  // `items` also changes on renewals, so we compare the plans themselves.
  const previousPrice = previousAttributes?.items?.data?.[0]?.price;
  const previousPaymentPlanId =
    previousPrice && findPaymentPlanIdByPriceId(previousPrice.id);
  if (
    previousPrice &&
    previousPaymentPlanId &&
    previousPaymentPlanId !== paymentPlanId
  ) {
    await trackPendoServerEvent("subscription_plan_changed", userId, {
      previous_payment_plan_id: previousPaymentPlanId,
      payment_plan_id: paymentPlanId,
      change_direction: getPlanChangeDirection(
        previousPrice,
        subscription.items.data[0].price,
      ),
      subscription_status: subscriptionStatus,
      payment_processor: "stripe",
    });
  }

  if (
    subscriptionStatus === SubscriptionStatus.CancelAtPeriodEnd &&
    previousAttributes?.cancel_at_period_end === false
  ) {
    await trackPendoServerEvent("subscription_cancellation_scheduled", userId, {
      payment_plan_id: paymentPlanId,
      cancel_at: stripeTimestampToIsoString(subscription.cancel_at),
      cancellation_reason: subscription.cancellation_details?.reason ?? null,
      cancellation_feedback:
        subscription.cancellation_details?.feedback ?? null,
      payment_processor: "stripe",
    });
  }

  if (
    subscriptionStatus === SubscriptionStatus.PastDue &&
    previousAttributes?.status !== undefined &&
    previousAttributes.status !== "past_due"
  ) {
    await trackPendoServerEvent("subscription_past_due", userId, {
      payment_plan_id: paymentPlanId,
      previous_status: previousAttributes.status,
      payment_processor: "stripe",
    });
  }
}

/**
 * Like `getPaymentPlanIdByPaymentProcessorPlanId`, but returns `undefined`
 * instead of throwing, e.g. for an old price that is no longer configured.
 */
function findPaymentPlanIdByPriceId(
  priceId: Stripe.Price["id"],
): PaymentPlanId | undefined {
  try {
    return getPaymentPlanIdByPaymentProcessorPlanId(priceId);
  } catch {
    return undefined;
  }
}

function getPlanChangeDirection(
  previousPrice: Stripe.Price,
  newPrice: Stripe.Price,
): "upgrade" | "downgrade" | "lateral" {
  const previousAmount = previousPrice.unit_amount ?? 0;
  const newAmount = newPrice.unit_amount ?? 0;
  if (newAmount > previousAmount) {
    return "upgrade";
  } else if (newAmount < previousAmount) {
    return "downgrade";
  } else {
    return "lateral";
  }
}

function getOpenSaasSubscriptionStatus(
  subscription: Stripe.Subscription,
): SubscriptionStatus | undefined {
  const stripeToOpenSaasSubscriptionStatus: Record<
    Stripe.Subscription.Status,
    SubscriptionStatus | undefined
  > = {
    trialing: SubscriptionStatus.Active,
    active: SubscriptionStatus.Active,
    past_due: SubscriptionStatus.PastDue,
    canceled: SubscriptionStatus.Deleted,
    unpaid: SubscriptionStatus.Deleted,
    incomplete_expired: SubscriptionStatus.Deleted,
    paused: undefined,
    incomplete: undefined,
  };

  const subscriptionStatus =
    stripeToOpenSaasSubscriptionStatus[subscription.status];

  if (
    subscriptionStatus === SubscriptionStatus.Active &&
    subscription.cancel_at_period_end
  ) {
    return SubscriptionStatus.CancelAtPeriodEnd;
  }

  return subscriptionStatus;
}

function getSubscriptionPriceId(
  subscription: Stripe.Subscription,
): Stripe.Price["id"] {
  const subscriptionItems = subscription.items.data;
  // We only expect one subscription item.
  // If your workflow expects more, you should change this function to handle them.
  if (subscriptionItems.length !== 1) {
    throw new Error(
      "There should be exactly one subscription item in Stripe subscription",
    );
  }

  return subscriptionItems[0].price.id;
}

async function handleCustomerSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent,
  prismaUserDelegate: PrismaClient["user"],
): Promise<void> {
  const subscription = event.data.object;
  const customerId = getCustomerId(subscription.customer);

  const user = await updateUserSubscription(
    {
      paymentProcessorUserId: customerId,
      subscriptionStatus: SubscriptionStatus.Deleted,
    },
    prismaUserDelegate,
  );

  await trackPendoServerEvent("subscription_ended", user.id, {
    // We don't clear the plan when a subscription ends, so this is the ended plan.
    payment_plan_id: user.subscriptionPlan,
    cancellation_reason: subscription.cancellation_details?.reason ?? null,
    ended_at: stripeTimestampToIsoString(subscription.ended_at),
    subscription_duration_days: subscription.ended_at
      ? Math.round((subscription.ended_at - subscription.start_date) / 86400)
      : null,
    payment_processor: "stripe",
  });
}

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Stripe.Customer["id"] {
  if (!customer) {
    throw new Error("Customer is missing");
  } else if (typeof customer === "string") {
    return customer;
  } else {
    return customer.id;
  }
}

function getInvoicePaidAtDate(invoice: Stripe.Invoice): Date {
  if (!invoice.status_transitions.paid_at) {
    throw new Error("Invoice has not been paid yet");
  }

  // Stripe returns timestamps in seconds (Unix time),
  // so we multiply by 1000 to convert to milliseconds.
  return new Date(invoice.status_transitions.paid_at * 1000);
}

function stripeTimestampToIsoString(timestamp: number | null): string | null {
  // Stripe timestamps are in seconds (Unix time).
  return timestamp === null ? null : new Date(timestamp * 1000).toISOString();
}
