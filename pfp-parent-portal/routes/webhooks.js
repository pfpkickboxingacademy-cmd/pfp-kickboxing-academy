const express = require("express");
const db = require("../db");
const { constructWebhookEvent } = require("../services/billing");

const router = express.Router();

// Stripe requires the raw (unparsed) request body to verify the webhook
// signature, so this route uses express.raw instead of the app-wide
// express.urlencoded/json parsers (see server.js — this router must be
// mounted before those run).
router.post("/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const setStatus = (subscriptionId, status) => {
    const info = db
      .prepare(`UPDATE parents SET billing_status = ? WHERE stripe_subscription_id = ?`)
      .run(status, subscriptionId);
    return info.changes;
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const parentId = session.metadata && session.metadata.parent_id;
      if (parentId) {
        db.prepare(
          `UPDATE parents SET billing_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`
        ).run(session.customer, session.subscription, parentId);
        console.log(`[STRIPE] Parent #${parentId} billing activated.`);
      }
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      if (invoice.subscription) setStatus(invoice.subscription, "active");
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      if (invoice.subscription) setStatus(invoice.subscription, "past_due");
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      setStatus(sub.id, "canceled");
      break;
    }
    default:
      // Not every event type needs handling — safe to ignore the rest.
      break;
  }

  res.json({ received: true });
});

module.exports = router;
