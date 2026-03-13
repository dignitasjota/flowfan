import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getStripe, getPlanFromPriceId } from "@/lib/stripe";
import { db } from "@/server/db";
import { creators } from "@/server/db/schema";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("stripe-webhook");

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    log.error({ err }, "Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const creatorId = session.metadata?.creatorId;
        if (!creatorId || !session.subscription) break;

        const subscription = await getStripe().subscriptions.retrieve(
          session.subscription as string
        );
        const subItem = subscription.items.data[0];
        const priceId = subItem?.price.id;
        const plan = priceId ? getPlanFromPriceId(priceId) : null;
        const periodEnd = subItem?.current_period_end;

        if (plan) {
          await db
            .update(creators)
            .set({
              subscriptionPlan: plan,
              subscriptionStatus: "active",
              stripeSubscriptionId: subscription.id,
              stripePriceId: priceId,
              ...(periodEnd && {
                currentPeriodEnd: new Date(periodEnd * 1000),
              }),
              updatedAt: new Date(),
            })
            .where(eq(creators.id, creatorId));
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;

        const creator = await db.query.creators.findFirst({
          where: eq(creators.stripeCustomerId, customerId),
          columns: { id: true },
        });
        if (!creator) break;

        const subItem = subscription.items.data[0];
        const priceId = subItem?.price.id;
        const plan = priceId ? getPlanFromPriceId(priceId) : null;
        const periodEnd = subItem?.current_period_end;

        const statusMap: Record<string, string> = {
          active: "active",
          past_due: "past_due",
          canceled: "canceled",
          trialing: "trialing",
          incomplete: "active",
          incomplete_expired: "canceled",
          unpaid: "past_due",
          paused: "active",
        };

        await db
          .update(creators)
          .set({
            ...(plan && { subscriptionPlan: plan }),
            subscriptionStatus: (statusMap[subscription.status] ?? "active") as any,
            stripePriceId: priceId,
            ...(periodEnd && {
              currentPeriodEnd: new Date(periodEnd * 1000),
            }),
            updatedAt: new Date(),
          })
          .where(eq(creators.id, creator.id));
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;

        const creator = await db.query.creators.findFirst({
          where: eq(creators.stripeCustomerId, customerId),
          columns: { id: true },
        });
        if (!creator) break;

        await db
          .update(creators)
          .set({
            subscriptionPlan: "free",
            subscriptionStatus: "canceled",
            stripeSubscriptionId: null,
            stripePriceId: null,
            currentPeriodEnd: null,
            updatedAt: new Date(),
          })
          .where(eq(creators.id, creator.id));
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : (invoice.customer as any)?.id;

        if (!customerId) break;

        const creator = await db.query.creators.findFirst({
          where: eq(creators.stripeCustomerId, customerId),
          columns: { id: true },
        });
        if (!creator) break;

        await db
          .update(creators)
          .set({
            subscriptionStatus: "past_due",
            updatedAt: new Date(),
          })
          .where(eq(creators.id, creator.id));
        break;
      }
    }
  } catch (err) {
    log.error({ err }, "Error processing webhook event");
  }

  return NextResponse.json({ received: true });
}
