// Runs the reminder sweep every 5 minutes for as long as the process is
// alive. Fine for an always-on host (Render, Railway, Fly.io, a VPS).
//
// NOT suitable for Vercel serverless as-is, since serverless functions
// don't stay running in the background. If you deploy there instead, wire
// this same runReminderSweep() call to Vercel Cron
// (https://vercel.com/docs/cron-jobs) hitting an API route on a schedule.
const cron = require("node-cron");
const { runReminderSweep } = require("./services/reminders");

const SCHEDULE = process.env.REMINDER_CRON_SCHEDULE || "*/5 * * * *";

cron.schedule(SCHEDULE, () => {
  runReminderSweep().catch((err) => console.error("Reminder sweep failed:", err));
});

console.log(`Reminder cron scheduled: "${SCHEDULE}"`);
