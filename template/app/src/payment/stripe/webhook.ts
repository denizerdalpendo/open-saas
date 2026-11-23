import { type PrismaClient } from "@prisma/client";
import express from "express";
import type { Stripe } from "stripe";
import { type MiddlewareConfigFn } from "wasp/server";
import { type PaymentsWebhook } from "wasp/server/api";
import { emailSender } from "wasp/server/email";
import { trackPendoEvent } from "../../server/pendoTrack";
import { requireNodeEnvVar } from "../../server/utils";
import { assertUnreachable } from "../../shared/utils";
import { UnhandledWebhookEventError } from "../errors";
import {
  getPaymentPlanIdByPaymentProcessorPlanId,
  PaymentPlanId,
  paymentPlans,
  SubscriptionStatus,
} from "../plans";
import {
  fetchUserPaymentStateByPaymentProcessorUserId,
  updateUserCredits,
  updateUserSubscription,
} from "../user";
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

  // Stripe can redeliver the same `invoice.paid` event. Each invoice has its own
  // paid date, so we only track an invoice whose paid date isn't saved yet.
  const previousPaymentState =
    await fetchUserPaymentStateByPaymentProcessorUserId(
      customerId,
      prismaUserDelegate,
    );
  const isNewlyRecordedPayment =
    previousPaymentState?.datePaid?.getTime() !== invoicePaidAtDate.getTime();

  switch (paymentPlanId) {
    case PaymentPlanId.Credits10: {
      const numOfCreditsPurchased = paymentPlans[paymentPlanId].effect.amount;
      const user = await updateUserCredits(
        {
          paymentProcessorUserId: customerId,
          datePaid: invoicePaidAtDate,
          numOfCreditsPurchased,
        },
        prismaUserDelegate,
      );
      if (isNewlyRecordedPayment) {
        // Tracks a paid one-time credits purchase.
        void trackPendoEvent({
          event: "credits_purchased",
          visitorId: user.id,
          properties: {
            payment_plan_id: paymentPlanId,
            num_of_credits_purchased: numOfCreditsPurchased,
            payment_processor: "stripe",
            date_paid: invoicePaidAtDate.toISOString(),
          },
        });
      }
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
      if (isNewlyRecordedPayment) {
        // Tracks a paid subscription invoice (first payment or renewal).
        void trackPendoEvent({
          event: "subscription_payment_completed",
          visitorId: user.id,
          properties: {
            payment_plan_id: paymentPlanId,
            subscription_status: user.subscriptionStatus,
            previous_subscription_status:
              previousPaymentState?.subscriptionStatus ?? null,
            payment_processor: "stripe",
            date_paid: invoicePaidAtDate.toISOString(),
          },
        });
      }
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

  const previousPaymentState =
    await fetchUserPaymentStateByPaymentProcessorUserId(
      customerId,
      prismaUserDelegate,
    );

  const user = await updateUserSubscription(
    { paymentProcessorUserId: customerId, paymentPlanId, subscriptionStatus },
    prismaUserDelegate,
  );

  // We only track status transitions, so redelivered webhooks don't fire twice.
  if (
    subscriptionStatus === SubscriptionStatus.CancelAtPeriodEnd &&
    previousPaymentState?.subscriptionStatus !==
      SubscriptionStatus.CancelAtPeriodEnd
  ) {
    // Tracks a subscription that is set to cancel at the end of the period.
    void trackPendoEvent({
      event: "subscription_cancellation_scheduled",
      visitorId: user.id,
      properties: {
        payment_plan_id: paymentPlanId,
        subscription_status: subscriptionStatus,
        payment_processor: "stripe",
      },
    });
  } else if (
    subscriptionStatus === SubscriptionStatus.Deleted &&
    previousPaymentState?.subscriptionStatus !== SubscriptionStatus.Deleted
  ) {
    // Tracks a subscription that ended (canceled, unpaid, or expired).
    void trackPendoEvent({
      event: "subscription_ended",
      visitorId: user.id,
      properties: {
        previous_payment_plan_id:
          previousPaymentState?.subscriptionPlan ?? null,
        subscription_status: subscriptionStatus,
        payment_processor: "stripe",
      },
    });
  }

  if (subscription.cancel_at_period_end && user.email) {
    await emailSender.send({
      to: user.email,
      subject: "We hate to see you go :(",
      text: "We hate to see you go. Here is a sweet offer...",
      html: "We hate to see you go. Here is a sweet offer...",
    });
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

  const previousPaymentState =
    await fetchUserPaymentStateByPaymentProcessorUserId(
      customerId,
      prismaUserDelegate,
    );

  const user = await updateUserSubscription(
    {
      paymentProcessorUserId: customerId,
      subscriptionStatus: SubscriptionStatus.Deleted,
    },
    prismaUserDelegate,
  );

  // A `customer.subscription.updated` event can already have set the status to
  // deleted, so we only track the transition once.
  if (previousPaymentState?.subscriptionStatus !== SubscriptionStatus.Deleted) {
    // Tracks a subscription that ended.
    void trackPendoEvent({
      event: "subscription_ended",
      visitorId: user.id,
      properties: {
        previous_payment_plan_id:
          previousPaymentState?.subscriptionPlan ?? null,
        subscription_status: SubscriptionStatus.Deleted,
        payment_processor: "stripe",
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
