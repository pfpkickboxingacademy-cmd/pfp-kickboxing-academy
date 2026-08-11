const express = require("express");
const db = require("../db");
const { publicKey } = require("../services/push");

const router = express.Router();
router.use(express.json());

router.get("/public-key", (req, res) => {
  res.json({ publicKey: publicKey() });
});

router.post("/subscribe", (req, res) => {
  // Trusts the logged-in session, not a client-supplied email — otherwise
  // anyone could POST someone else's email and hijack their notifications.
  if (!req.session || !req.session.parentId) {
    return res.status(401).json({ error: "Log in to the Parent Portal first." });
  }
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Missing subscription." });
  }

  db.prepare(
    `INSERT INTO push_subscriptions (parent_id, endpoint, p256dh, auth)
     VALUES (@parent_id, @endpoint, @p256dh, @auth)
     ON CONFLICT(endpoint) DO UPDATE SET parent_id = excluded.parent_id`
  ).run({
    parent_id: req.session.parentId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  });

  res.json({ ok: true });
});

router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
  res.json({ ok: true });
});

module.exports = router;
