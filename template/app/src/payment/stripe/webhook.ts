import { type PrismaClient } from "@prisma/client";
import express from "express";
import type { Stripe } from "stripe";
import { type MiddlewareConfigFn } from "wasp/server";
import { type PaymentsWebhook } from "wasp/server/api";
import { emailSender } from "wasp/server/email";
import { sendPendoTrackEvent } from "../../server/pendo";
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
      await sendPendoTrackEvent("credits_purchased", user.id, {
        payment_plan_id: paymentPlanId,
        num_of_credits_purchased: paymentPlans[paymentPlanId].effect.amount,
        credits_balance: user.credits,
        // In the currency's smallest unit (e.g. cents).
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
      await sendPendoTrackEvent("subscription_payment_succeeded", user.id, {
        payment_plan_id: paymentPlanId,
        // "subscription_create" (first payment), "subscription_cycle" (renewal)
        // or "subscription_update" (plan change proration).
        billing_reason: invoice.billing_reason,
        // In the currency's smallest unit (e.g. cents).
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

  if (subscription.cancel_at_period_end && user.email) {
    await emailSender.send({
      to: user.email,
      subject: "We hate to see you go :(",
      text: "We hate to see you go. Here is a sweet offer...",
      html: "We hate to see you go. Here is a sweet offer...",
    });
  }

  // We send Pendo Track Events last, so that if a step above fails and
  // Stripe retries the webhook, the events aren't sent twice.
  if (
    subscriptionStatus === SubscriptionStatus.CancelAtPeriodEnd &&
    event.data.previous_attributes?.cancel_at_period_end === false
  ) {
    await sendPendoTrackEvent("subscription_cancellation_scheduled", user.id, {
      payment_plan_id: paymentPlanId,
      subscription_status: subscriptionStatus,
      cancel_at: getIsoStringFromStripeTimestamp(subscription.cancel_at),
      cancellation_reason: subscription.cancellation_details?.reason,
      cancellation_feedback: subscription.cancellation_details?.feedback,
      payment_processor: "stripe",
    });
  }

  const previousPaymentPlanId = getPreviousSubscriptionPaymentPlanId(event);
  if (previousPaymentPlanId && previousPaymentPlanId !== paymentPlanId) {
    await sendPendoTrackEvent("subscription_plan_changed", user.id, {
      previous_plan_id: previousPaymentPlanId,
      new_plan_id: paymentPlanId,
      // Pro is the higher of the two subscription plans.
      change_direction:
        paymentPlanId === PaymentPlanId.Pro ? "upgrade" : "downgrade",
      subscription_status: subscriptionStatus,
      payment_processor: "stripe",
    });
  }
}

/**
 * Returns the plan that the subscription was on before this update,
 * if the update changed the subscription's price.
 */
function getPreviousSubscriptionPaymentPlanId(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
): PaymentPlanId | undefined {
  const previousPriceId =
    event.data.previous_attributes?.items?.data[0]?.price.id;
  if (!previousPriceId) {
    return undefined;
  }

  try {
    return getPaymentPlanIdByPaymentProcessorPlanId(previousPriceId);
  } catch {
    // The previous price isn't one of our payment plans (e.g. a since-removed price),
    // which shouldn't fail the webhook.
    return undefined;
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

  await sendPendoTrackEvent("subscription_canceled", user.id, {
    // The plan isn't cleared when the subscription is deleted, so this is the plan that ended.
    payment_plan_id: user.subscriptionPlan,
    cancellation_reason: subscription.cancellation_details?.reason,
    cancellation_feedback: subscription.cancellation_details?.feedback,
    subscription_start_date: getIsoStringFromStripeTimestamp(
      subscription.start_date,
    ),
    ended_at: getIsoStringFromStripeTimestamp(subscription.ended_at),
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

function getIsoStringFromStripeTimestamp(
  stripeTimestamp: number | null,
): string | undefined {
  if (!stripeTimestamp) {
    return undefined;
  }

  // Stripe timestamps are in seconds (Unix time).
  return new Date(stripeTimestamp * 1000).toISOString();
}
