import { type PrismaClient } from "@prisma/client";
import express from "express";
import type { Stripe } from "stripe";
import { type User } from "wasp/entities";
import { type MiddlewareConfigFn } from "wasp/server";
import { type PaymentsWebhook } from "wasp/server/api";
import { emailSender } from "wasp/server/email";
import { trackPendoServerEvent } from "../../server/pendo";
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
      await trackPendoServerEvent({
        event: "credits_purchased",
        visitorId: user.id,
        properties: {
          paymentPlanId,
          numOfCreditsPurchased: paymentPlans[paymentPlanId].effect.amount,
          newCreditBalance: user.credits,
          amountPaid: invoice.amount_paid / 100,
          currency: invoice.currency,
          datePaid: invoicePaidAtDate.toISOString(),
          paymentProcessor: "stripe",
        },
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
      await trackPendoServerEvent({
        event: "subscription_payment_succeeded",
        visitorId: user.id,
        properties: {
          paymentPlanId,
          // `subscription_create` for new subscriptions, `subscription_cycle` for renewals.
          billingReason: invoice.billing_reason,
          amountPaid: invoice.amount_paid / 100,
          currency: invoice.currency,
          invoiceId: invoice.id,
          datePaid: invoicePaidAtDate.toISOString(),
          subscriptionStatus: SubscriptionStatus.Active,
          paymentProcessor: "stripe",
        },
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

  await trackSubscriptionUpdatedInPendo(
    event,
    user,
    paymentPlanId,
    subscriptionStatus,
  );
}

/**
 * Sends Pendo Track Events for the subscription changes in a
 * `customer.subscription.updated` event. Each one is gated on
 * `previous_attributes`, which only holds the fields that changed in this
 * update, so unrelated or repeated updates don't send them again.
 */
async function trackSubscriptionUpdatedInPendo(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
  user: User,
  paymentPlanId: PaymentPlanId,
  subscriptionStatus: SubscriptionStatus,
): Promise<void> {
  const subscription = event.data.object;
  const previousAttributes = event.data.previous_attributes;

  try {
    if (
      subscription.cancel_at_period_end &&
      previousAttributes?.cancel_at_period_end === false
    ) {
      await trackPendoServerEvent({
        event: "subscription_canceled",
        visitorId: user.id,
        properties: {
          paymentPlanId,
          subscriptionStatus,
          cancelAt: subscription.cancel_at
            ? new Date(subscription.cancel_at * 1000).toISOString()
            : null,
          cancellationReason: subscription.cancellation_details?.reason,
          cancellationFeedback: subscription.cancellation_details?.feedback,
          winBackEmailSent: !!user.email,
          paymentProcessor: "stripe",
        },
      });
    }

    const previousPriceId = previousAttributes?.items?.data[0]?.price.id;
    if (previousPriceId) {
      const previousPaymentPlanId =
        getPaymentPlanIdByPaymentProcessorPlanId(previousPriceId);
      if (previousPaymentPlanId !== paymentPlanId) {
        await trackPendoServerEvent({
          event: "subscription_plan_changed",
          visitorId: user.id,
          properties: {
            previousPaymentPlanId,
            newPaymentPlanId: paymentPlanId,
            changeDirection:
              paymentPlanId === PaymentPlanId.Pro ? "upgrade" : "downgrade",
            subscriptionStatus,
            paymentProcessor: "stripe",
          },
        });
      }
    }

    // `status` is only in `previous_attributes` if it changed in this update.
    const previousStripeStatus = previousAttributes?.status;
    if (!previousStripeStatus) {
      return;
    }

    if (subscriptionStatus === SubscriptionStatus.PastDue) {
      await trackPendoServerEvent({
        event: "subscription_payment_past_due",
        visitorId: user.id,
        properties: {
          paymentPlanId,
          subscriptionStatus,
          previousSubscriptionStatus: previousStripeStatus,
          latestInvoiceId:
            typeof subscription.latest_invoice === "string"
              ? subscription.latest_invoice
              : subscription.latest_invoice?.id,
          paymentProcessor: "stripe",
        },
      });
    }

    // Canceled subscriptions are tracked when `customer.subscription.deleted`
    // arrives, and `incomplete_expired` ones never had access, so only
    // `unpaid` subscriptions lose access here.
    if (subscription.status === "unpaid") {
      await trackPendoServerEvent({
        event: "subscription_ended",
        visitorId: user.id,
        properties: {
          paymentPlanId,
          subscriptionStatus,
          endReason:
            subscription.cancellation_details?.reason ?? subscription.status,
          cancellationFeedback: subscription.cancellation_details?.feedback,
          paymentProcessor: "stripe",
        },
      });
    }
  } catch (error) {
    // E.g. a previous price that isn't one of our payment plans anymore.
    console.error(
      "Failed to track Stripe subscription update in Pendo:",
      error,
    );
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

  // Read before the update, so a subscription that already lost access (e.g.
  // became `unpaid`) isn't reported to Pendo as ended twice.
  const previousSubscriptionStatus = (
    await prismaUserDelegate.findUnique({
      where: { paymentProcessorUserId: customerId },
      select: { subscriptionStatus: true },
    })
  )?.subscriptionStatus;

  const user = await updateUserSubscription(
    {
      paymentProcessorUserId: customerId,
      subscriptionStatus: SubscriptionStatus.Deleted,
    },
    prismaUserDelegate,
  );

  if (previousSubscriptionStatus !== SubscriptionStatus.Deleted) {
    await trackPendoServerEvent({
      event: "subscription_ended",
      visitorId: user.id,
      properties: {
        // Not cleared by the update above, so it's still the ended plan.
        paymentPlanId: user.subscriptionPlan,
        subscriptionStatus: SubscriptionStatus.Deleted,
        endReason:
          subscription.cancellation_details?.reason ?? subscription.status,
        cancellationFeedback: subscription.cancellation_details?.feedback,
        paymentProcessor: "stripe",
      },
    });
  }
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
