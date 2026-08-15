// Square subscription billing. Mirrors the dry-run pattern used in
// notify.js: with no SQUARE_ACCESS_TOKEN set, sign-ups still work end to
// end (billing_status is set to "active" immediately, no real card
// required), so the whole app is testable before a Square account exists.
//
// How Square subscriptions work here (see Square's Checkout API docs,
// "Subscription Plan Checkout"):
//   1. A single shared Catalog "Subscription Plan" + "Subscription Plan
//      Variation" is created once (ensureCatalogPlan) for the flat
//      $139/mo PFP Kickboxing Membership — every program uses the same
//      variation, since pricing is identical across Karate Cubs, Lion
//      Pride, Teens, and Adults. The variation's ID is cached in the
//      app_settings table and copied onto every row in `plans` so nothing
//      needs to be re-created on restart.
//   2. Checkout uses CreatePaymentLink (Checkout API) with
//      checkout_options.subscription_plan_id set to the VARIATION's id
//      (not the parent plan's id — Square's own docs call this out as a
//      common mistake) and quick_pay.price_money matching that variation's
//      price exactly. Square's hosted checkout page collects the card,
//      creates/matches a Customer by the buyer's info, stores the card on
//      file, and creates the Subscription automatically — this app never
//      touches card data.
//   3. Square webhooks (routes/webhooks.js) keep billing_status in sync as
//      invoices are paid or fail and as the subscription's status changes.

const crypto = require("crypto");
const db = require("../db");

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_ENVIRONMENT = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const SQUARE_API_VERSION = "2026-07-15";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const SQUARE_BASE_URL =
  SQUARE_ENVIRONMENT === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";

const MEMBERSHIP_PRICE_CENTS = 13900; // flat $139/mo, every program, founding or not
const MEMBERSHIP_PLAN_NAME = "PFP Kickboxing Membership";
const MEMBERSHIP_VARIATION_NAME = "Monthly - $139";

const isLive = () => !!(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);

async function squareRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${SQUARE_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (json.errors || []).map((e) => e.detail || e.code).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Square API error: ${message}`);
  }
  return json;
}

function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value
  );
}

// Idempotently ensures the shared "$139/mo PFP Kickboxing Membership"
// Catalog subscription plan + variation exist in this Square account, and
// that every row in `plans` points at the resulting variation ID. Safe to
// call on every server start — it's a no-op once cached.
async function ensureCatalogPlan() {
  if (!isLive()) return null;

  const cached = getSetting("square_plan_variation_id");
  if (cached) return cached;

  const result = await squareRequest("/v2/catalog/object", {
    method: "POST",
    body: {
      idempotency_key: crypto.randomUUID(),
      object: {
        type: "SUBSCRIPTION_PLAN",
        id: "#pfp_membership_plan",
        subscription_plan_data: {
          name: MEMBERSHIP_PLAN_NAME,
          subscription_plan_variations: [
            {
              type: "SUBSCRIPTION_PLAN_VARIATION",
              id: "#pfp_membership_variation",
              subscription_plan_variation_data: {
                name: MEMBERSHIP_VARIATION_NAME,
                phases: [
                  {
                    cadence: "MONTHLY",
                    periods: 0, // 0 = runs indefinitely until canceled
                    recurring_price_money: { amount: MEMBERSHIP_PRICE_CENTS, currency: "USD" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  });

  const mapping = (result.id_mappings || []).find((m) => m.client_object_id === "#pfp_membership_variation");
  const variationId = mapping ? mapping.object_id : null;
  const planMapping = (result.id_mappings || []).find((m) => m.client_object_id === "#pfp_membership_plan");

  if (!variationId) throw new Error("Square didn't return a subscription plan variation ID — check the Catalog API response.");

  setSetting("square_plan_variation_id", variationId);
  if (planMapping) setSetting("square_subscription_plan_id", planMapping.object_id);
  db.prepare("UPDATE plans SET square_plan_variation_id = ?").run(variationId);

  console.log(`[SQUARE] Created shared subscription plan variation ${variationId} ($139/mo).`);
  return variationId;
}

// Returns { checkoutUrl } to redirect the browser to, or { dryRun: true }
// if Square isn't configured yet.
async function startSubscriptionCheckout({ parent, plan, student }) {
  if (!isLive()) {
    console.log(
      `[DRY RUN SQUARE] Would start a $${(MEMBERSHIP_PRICE_CENTS / 100).toFixed(2)}/mo subscription checkout for ${parent.email} (${plan.name}). Marking billing_status=active instead of charging.`
    );
    return { dryRun: true };
  }

  const variationId = plan.square_plan_variation_id || (await ensureCatalogPlan());
  if (!variationId) {
    throw new Error("No Square subscription plan variation is set up yet. Restart the server with SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID set so it can be created automatically.");
  }

  const result = await squareRequest("/v2/online-checkout/payment-links", {
    method: "POST",
    body: {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: `PFP Kickboxing Membership${student ? ` — ${student.name}` : ""} (${plan.program})`,
        price_money: { amount: MEMBERSHIP_PRICE_CENTS, currency: "USD" },
        location_id: SQUARE_LOCATION_ID,
      },
      checkout_options: {
        subscription_plan_id: variationId,
        redirect_url: `${APP_URL}/portal/dashboard?billing=success`,
      },
      pre_populated_data: {
        buyer_email: parent.email,
      },
      payment_note: `PFP parent #${parent.id}`,
    },
  });

  return { dryRun: false, checkoutUrl: result.payment_link.url };
}

// Verifies an incoming Square webhook using its HMAC-SHA256 signature
// scheme (base64(HMAC-SHA256(signature_key, notification_url + body))),
// compared against the x-square-hmacsha256-signature header. Falls back to
// trusting the raw JSON body if no signature key is configured yet, so
// local testing works before that's wired up.
function verifyAndParseWebhook(rawBody, signatureHeader, notificationUrl) {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.warn("[SQUARE] No webhook signature key configured — skipping signature verification (dev/dry-run mode only).");
    return JSON.parse(rawBody.toString());
  }
  const hmac = crypto.createHmac("sha256", SQUARE_WEBHOOK_SIGNATURE_KEY);
  hmac.update(notificationUrl + rawBody.toString());
  const expected = hmac.digest("base64");
  const provided = signatureHeader || "";
  const ok =
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!ok) throw new Error("Square webhook signature mismatch.");
  return JSON.parse(rawBody.toString());
}

// Looks up a Square Customer's email so webhook events (which only carry
// customer_id) can be matched back to a `parents` row by email.
async function fetchSquareCustomerEmail(customerId) {
  if (!isLive() || !customerId) return null;
  try {
    const result = await squareRequest(`/v2/customers/${customerId}`);
    return (result.customer && result.customer.email_address) || null;
  } catch (err) {
    console.error(`[SQUARE] Couldn't look up customer ${customerId}:`, err.message);
    return null;
  }
}

// Square doesn't offer a Stripe-style self-serve "billing portal" out of
// the box. The pragmatic equivalent: generate a fresh payment link for the
// same $139/mo plan — when the parent completes it, Square swaps in the
// new card for future charges. Good enough for "my card expired," not a
// full subscription-management UI.
async function createUpdateCardLink({ parent }) {
  if (!isLive()) return { dryRun: true };
  const variationId = getSetting("square_plan_variation_id") || (await ensureCatalogPlan());
  const result = await squareRequest("/v2/online-checkout/payment-links", {
    method: "POST",
    body: {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: "PFP Kickboxing Membership — Update Card on File",
        price_money: { amount: MEMBERSHIP_PRICE_CENTS, currency: "USD" },
        location_id: SQUARE_LOCATION_ID,
      },
      checkout_options: {
        subscription_plan_id: variationId,
        redirect_url: `${APP_URL}/portal/dashboard?billing=success`,
      },
      pre_populated_data: { buyer_email: parent.email },
      payment_note: `PFP parent #${parent.id} — card update`,
    },
  });
  return { dryRun: false, portalUrl: result.payment_link.url };
}

module.exports = {
  isLive,
  ensureCatalogPlan,
  startSubscriptionCheckout,
  verifyAndParseWebhook,
  fetchSquareCustomerEmail,
  createUpdateCardLink,
  MEMBERSHIP_PRICE_CENTS,
};
