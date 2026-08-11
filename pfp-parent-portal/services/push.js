// Web Push (the notification channel for the installed PWA). Same
// dry-run pattern as notify.js: with no VAPID keys set, pushes just log to
// the console, so the whole subscribe -> notify loop is testable before
// generating real keys.
//
// Generate real keys once with: npx web-push generate-vapid-keys

const db = require("../db");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:PFPkickboxingacademy@gmail.com";

let webpush = null;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush = require("web-push");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function isConfigured() {
  return !!webpush;
}

function publicKey() {
  return VAPID_PUBLIC_KEY || null;
}

// Sends to every device a parent has installed the app on. Prunes
// subscriptions the browser has revoked (410/404 responses).
async function sendPushToParent(parentId, { title, body }) {
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE parent_id = ?`).all(parentId);
  if (subs.length === 0) return [];

  const payload = JSON.stringify({ title, body });
  const results = [];

  for (const sub of subs) {
    if (!webpush) {
      console.log(`[DRY RUN PUSH] to parent #${parentId} (${sub.endpoint.slice(0, 40)}...)\n${title}: ${body}\n`);
      results.push({ ok: true, dryRun: true });
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      results.push({ ok: true, dryRun: false });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(sub.id);
      } else {
        console.error("Push send failed:", err.message);
      }
      results.push({ ok: false, dryRun: false, error: err.message });
    }
  }
  return results;
}

module.exports = { isConfigured, publicKey, sendPushToParent };
