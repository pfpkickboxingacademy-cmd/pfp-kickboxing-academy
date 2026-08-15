const express = require("express");
const db = require("../db");
const { verifyAndParseWebhook, fetchSquareCustomerEmail } = require("../services/billing");

const router = express.Router();

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Square requires the raw (unparsed) request body to verify the webhook
// signature, so this route uses express.raw instead of the app-wide
// express.urlencoded/json parsers (see server.js — this router must be
// mounted before those run).
router.post("/square", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = verifyAndParseWebhook(req.body, req.headers["x-square-hmacsha256-signature"], `${APP_URL}/webhooks/square`);
  } catch (err) {
    console.error("Square webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const setStatusByEmail = async (customerId, subscriptionId, status) => {
    if (subscriptionId) {
      const info = db
        .prepare(`UPDATE parents SET billing_status = ?, square_subscription_id = ? WHERE square_subscription_id = ?`)
        .run(status, subscriptionId, subscriptionId);
      if (info.changes) return true;
    }
    // First time we see this subscription/customer, match by email instead
    // and backfill the Square IDs onto the parent row.
    const email = await fetchSquareCustomerEmail(customerId);
    if (!email) return false;
    const info = db
      .prepare(`UPDATE parents SET billing_status = ?, square_customer_id = ?, square_subscription_id = COALESCE(?, square_subscription_id) WHERE email = ?`)
      .run(status, customerId || null, subscriptionId || null, email);
    return info.changes > 0;
  };

  try {
    switch (event.type) {
      case "subscription.created":
      case "subscription.updated": {
        const sub = event.data && event.data.object && event.data.object.subscription;
        if (sub) {
          const status = sub.status === "ACTIVE" ? "active" : sub.status === "CANCELED" || sub.status === "DEACTIVATED" ? "canceled" : "past_due";
          const changed = await setStatusByEmail(sub.customer_id, sub.id, status);
          console.log(`[SQUARE] Subscription ${sub.id} -> ${status}${changed ? "" : " (no matching parent found)"}`);
        }
        break;
      }
      case "invoice.payment_made": {
        const invoice = event.data && event.data.object && event.data.object.invoice;
        if (invoice) {
          const changed = await setStatusByEmail(invoice.primary_recipient && invoice.primary_recipient.customer_id, invoice.subscription_id, "active");
          console.log(`[SQUARE] Invoice paid for subscription ${invoice.subscription_id}${changed ? "" : " (no matching parent found)"}`);
        }
        break;
      }
      case "invoice.updated": {
        const invoice = event.data && event.data.object && event.data.object.invoice;
        if (invoice && ["FAILED", "PAYMENT_REQUESTED", "OVERDUE"].includes(invoice.status)) {
          const changed = await setStatusByEmail(invoice.primary_recipient && invoice.primary_recipient.customer_id, invoice.subscription_id, "past_due");
          console.log(`[SQUARE] Invoice ${invoice.status} for subscription ${invoice.subscription_id}${changed ? "" : " (no matching parent found)"}`);
        }
        break;
      }
      default:
        // Not every event type needs handling — safe to ignore the rest.
        break;
    }
  } catch (err) {
    console.error("[SQUARE] Error handling webhook event:", err);
  }

  res.json({ received: true });
});

module.exports = router;
