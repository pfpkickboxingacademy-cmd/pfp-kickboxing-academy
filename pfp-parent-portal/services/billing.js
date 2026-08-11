// Stripe subscription billing. Mirrors the dry-run pattern used in
// notify.js: with no STRIPE_SECRET_KEY set, sign-ups still work end to end
// (billing_status is set to "active" immediately, no real card required),
// so the whole app is testable before a Stripe account exists.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require("stripe")(STRIPE_SECRET_KEY);
}

const isLive = () => !!stripe;

// Returns { checkoutUrl } to redirect the browser to, or { dryRun: true }
// if Stripe isn't configured yet.
async function startSubscriptionCheckout({ parent, plan }) {
  if (!stripe) {
    console.log(
      `[DRY RUN STRIPE] Would start a $${(plan.monthly_price_cents / 100).toFixed(2)}/mo subscription (${plan.name}) checkout for ${parent.email}. Marking billing_status=active instead of charging.`
    );
    return { dryRun: true };
  }

  if (!plan.stripe_price_id) {
    throw new Error(
      `Plan "${plan.name}" has no stripe_price_id set. Create a matching Price in your Stripe Dashboard and save its ID on this plan (see admin > Plans).`
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: parent.email,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${APP_URL}/portal/dashboard?email=${encodeURIComponent(parent.email)}&billing=success`,
    cancel_url: `${APP_URL}/portal/dashboard?email=${encodeURIComponent(parent.email)}&billing=canceled`,
    metadata: { parent_id: String(parent.id) },
  });

  return { dryRun: false, checkoutUrl: session.url };
}

// Verifies + parses an incoming Stripe webhook request. Falls back to
// trusting the raw JSON body (no signature check) if no webhook secret is
// configured yet, so local testing works before that's wired up.
function constructWebhookEvent(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    console.warn("[STRIPE] No webhook secret configured — skipping signature verification (dev/dry-run mode only).");
    return JSON.parse(rawBody.toString());
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

// Self-service "Manage Billing" — Stripe's hosted Customer Portal lets a
// parent update their card on file, view past invoices, and (if you enable
// it in the Stripe Dashboard) cancel. Requires the parent to already have a
// stripe_customer_id, which is set by the checkout.session.completed
// webhook the first time they pay.
async function createBillingPortalSession({ parent }) {
  if (!stripe || !parent.stripe_customer_id) {
    return { dryRun: true };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: parent.stripe_customer_id,
    return_url: `${APP_URL}/portal/dashboard?email=${encodeURIComponent(parent.email)}`,
  });
  return { dryRun: false, portalUrl: session.url };
}

module.exports = { isLive, startSubscriptionCheckout, constructWebhookEvent, createBillingPortalSession };
