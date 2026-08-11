// Email + SMS senders. If real API keys aren't set in .env, both fall back
// to a "dry run" that logs what WOULD have been sent, so the whole system
// is testable before any paid service is connected.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "PFP Kickboxing Academy <onboarding@resend.dev>";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;

async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.log(`[DRY RUN EMAIL] to=${to} subject="${subject}"\n${text}\n`);
    return { ok: true, dryRun: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend email failed (${res.status}): ${body}`);
    return { ok: false, dryRun: false, error: body };
  }
  return { ok: true, dryRun: false };
}

async function sendSMS({ to, body }) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.log(`[DRY RUN SMS] to=${to}\n${body}\n`);
    return { ok: true, dryRun: true };
  }
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const body2 = await res.text();
    console.error(`Twilio SMS failed (${res.status}): ${body2}`);
    return { ok: false, dryRun: false, error: body2 };
  }
  return { ok: true, dryRun: false };
}

module.exports = { sendEmail, sendSMS };
