// The reminder engine. One function, runReminderSweep(), checks five
// things every time it runs (called on a schedule by cron.js, or on demand
// from the admin "Run reminders now" button):
//
//   1. Classes starting soon      -> "class starts in X minutes"
//   2. Belt test milestones       -> "eligible for testing" + upcoming test date reminders
//   3. Upcoming events            -> "N days away" + "today" reminders
//   4. Past-due billing           -> payment issue nudge
//   5. New leads                  -> welcome message + a 3-day "still interested?" nudge
//
// Every send is logged to reminder_log with a unique key so re-running the
// sweep (or a cron overlap) never double-sends the same reminder. Each
// notification goes out on every channel the parent has available: email,
// SMS, and push (if they've installed the app and enabled notifications).

const db = require("../db");
const { sendEmail, sendSMS } = require("./notify");
const { sendPushToParent } = require("./push");

const CLASS_REMINDER_MINUTES = Number(process.env.CLASS_REMINDER_MINUTES || 60);
const EVENT_REMINDER_DAYS = Number(process.env.EVENT_REMINDER_DAYS || 3);
const LEAD_NUDGE_DAYS = Number(process.env.LEAD_NUDGE_DAYS || 3);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function alreadySent(type, refKey, channel, recipient) {
  return !!db
    .prepare(
      `SELECT 1 FROM reminder_log WHERE reminder_type=? AND reference_key=? AND channel=? AND recipient=?`
    )
    .get(type, refKey, channel, recipient);
}

function logSent(type, refKey, channel, recipient, dryRun) {
  db.prepare(
    `INSERT OR IGNORE INTO reminder_log (reminder_type, reference_key, channel, recipient, dry_run)
     VALUES (?, ?, ?, ?, ?)`
  ).run(type, refKey, channel, recipient, dryRun ? 1 : 0);
}

// parentId is required for the push channel; email/phone/opt-ins drive the
// other two. Pass whichever channels should be skipped (e.g. already sent)
// as false on email_opt_in / sms_opt_in for that call.
async function notifyParent(parent, { subject, text }, parentId) {
  const results = [];
  if (parent.email_opt_in && parent.email) {
    results.push({ channel: "email", recipient: parent.email, ...(await sendEmail({ to: parent.email, subject, text })) });
  }
  if (parent.sms_opt_in && parent.phone) {
    results.push({ channel: "sms", recipient: parent.phone, ...(await sendSMS({ to: parent.phone, body: text })) });
  }
  if (parentId) {
    const pushResults = await sendPushToParent(parentId, { title: subject, body: text });
    pushResults.forEach((r) => results.push({ channel: "push", recipient: `parent:${parentId}`, ...r }));
  }
  return results;
}

function logResults(type, refKey, results) {
  let sent = 0;
  results.forEach((r) => {
    logSent(type, refKey, r.channel, r.recipient, r.dryRun);
    sent++;
  });
  return sent;
}

async function runClassReminders(now) {
  const dow = now.getDay();
  const todayStr = now.toISOString().slice(0, 10);
  const classesToday = db.prepare(`SELECT * FROM classes WHERE day_of_week = ?`).all(dow);
  let sent = 0;

  for (const cls of classesToday) {
    const [h, m] = cls.start_time.split(":").map(Number);
    const classStart = new Date(now);
    classStart.setHours(h, m, 0, 0);
    const minutesUntil = (classStart - now) / 60000;

    // Fire once, inside the window (e.g. 60 min down to 55 min before start,
    // assuming the sweep runs every ~5 min) so it doesn't refire every tick.
    if (minutesUntil > CLASS_REMINDER_MINUTES || minutesUntil < CLASS_REMINDER_MINUTES - 5) continue;

    const refKey = `${cls.id}:${todayStr}`;
    const students = db
      .prepare(
        `SELECT s.*, p.id AS parent_row_id, p.name AS parent_name, p.email, p.phone, p.email_opt_in, p.sms_opt_in
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN parents p ON p.id = s.parent_id
         WHERE e.class_id = ?`
      )
      .all(cls.id);

    for (const s of students) {
      const alreadyEmail = s.email && alreadySent("class", refKey, "email", s.email);
      const alreadySms = s.phone && alreadySent("class", refKey, "sms", s.phone);
      const alreadyPush = alreadySent("class", refKey, "push", `parent:${s.parent_row_id}`);
      if (alreadyEmail && alreadySms && alreadyPush) continue;

      const text = `Hi ${s.parent_name}, just a reminder: ${s.name}'s ${cls.name} class starts at ${cls.start_time} today (${DAY_NAMES[dow]}) at PFP Kickboxing Academy. See you on the mats!`;
      const results = await notifyParent(
        {
          email: s.email,
          phone: s.phone,
          email_opt_in: s.email_opt_in && !alreadyEmail,
          sms_opt_in: s.sms_opt_in && !alreadySms,
        },
        { subject: `Class reminder: ${cls.name} starts at ${cls.start_time}`, text },
        alreadyPush ? null : s.parent_row_id
      );
      sent += logResults("class", refKey, results);
    }
  }
  return sent;
}

async function runBeltTestReminders(now) {
  let sent = 0;

  // 1) Newly eligible (attendance threshold reached) — one-time notice.
  const candidates = db
    .prepare(
      `SELECT s.*, p.name AS parent_name, p.email, p.phone, p.email_opt_in, p.sms_opt_in,
              bc.rank_name, bc.classes_required
       FROM students s
       JOIN parents p ON p.id = s.parent_id
       JOIN belt_curriculum bc ON bc.id = s.current_rank_id
       WHERE s.eligible_for_test = 0 AND s.classes_attended_at_rank >= bc.classes_required`
    )
    .all();

  for (const s of candidates) {
    db.prepare(`UPDATE students SET eligible_for_test = 1, test_eligibility_notified_at = datetime('now') WHERE id = ?`).run(s.id);
    const text = `Great news! ${s.name} has completed the requirements for their next belt test (currently ${s.rank_name}). We'll be in touch with the next testing date, or check the events page.`;
    const results = await notifyParent(s, { subject: `${s.name} is eligible for belt testing!`, text }, s.parent_id);
    sent += logResults("belt_test_eligible", String(s.id), results);
  }

  // 2) Students with a scheduled test_date — remind 3 days out and day-of.
  const scheduled = db
    .prepare(
      `SELECT s.*, p.name AS parent_name, p.email, p.phone, p.email_opt_in, p.sms_opt_in
       FROM students s JOIN parents p ON p.id = s.parent_id
       WHERE s.test_date IS NOT NULL`
    )
    .all();

  for (const s of scheduled) {
    const testDate = new Date(s.test_date + "T00:00:00");
    const daysUntil = Math.round((testDate - new Date(now.toDateString())) / 86400000);
    if (daysUntil !== EVENT_REMINDER_DAYS && daysUntil !== 0) continue;

    const refKey = `${s.id}:${s.test_date}:${daysUntil}`;
    const when = daysUntil === 0 ? "today" : `in ${daysUntil} days (${s.test_date})`;
    const text = `Reminder: ${s.name}'s belt test is ${when} at PFP Kickboxing Academy. Good luck!`;
    const results = await notifyParent(s, { subject: `Belt test reminder for ${s.name}`, text }, s.parent_id);
    sent += logResults("belt_test_date", refKey, results);
  }

  return sent;
}

async function runEventReminders(now) {
  let sent = 0;
  const events = db.prepare(`SELECT * FROM events WHERE event_date >= ?`).all(now.toISOString().slice(0, 10));
  const allParents = db.prepare(`SELECT * FROM parents`).all();

  for (const ev of events) {
    const eventDate = new Date(ev.event_date + "T00:00:00");
    const daysUntil = Math.round((eventDate - new Date(now.toDateString())) / 86400000);
    if (daysUntil !== EVENT_REMINDER_DAYS && daysUntil !== 0) continue;

    const refKey = `${ev.id}:${daysUntil}`;
    const when = daysUntil === 0 ? "today" : `in ${daysUntil} days, on ${ev.event_date}`;
    const timePart = ev.event_time ? ` at ${ev.event_time}` : "";
    const text = `Reminder: "${ev.title}" is ${when}${timePart} at ${ev.location || "PFP Kickboxing Academy"}. ${ev.description || ""}`.trim();

    for (const p of allParents) {
      const alreadyEmail = p.email && alreadySent("event", refKey, "email", p.email);
      const alreadySms = p.phone && alreadySent("event", refKey, "sms", p.phone);
      const alreadyPush = alreadySent("event", refKey, "push", `parent:${p.id}`);
      if (alreadyEmail && alreadySms && alreadyPush) continue;
      const results = await notifyParent(
        { ...p, email_opt_in: p.email_opt_in && !alreadyEmail, sms_opt_in: p.sms_opt_in && !alreadySms },
        { subject: `Upcoming event: ${ev.title}`, text },
        alreadyPush ? null : p.id
      );
      sent += logResults("event", refKey, results);
    }
  }
  return sent;
}

async function runBillingReminders(now) {
  let sent = 0;
  const todayStr = now.toISOString().slice(0, 10);
  const pastDue = db.prepare(`SELECT * FROM parents WHERE billing_status = 'past_due'`).all();

  for (const p of pastDue) {
    const refKey = `${p.id}:${todayStr}`;
    const alreadyEmail = p.email && alreadySent("billing", refKey, "email", p.email);
    const alreadySms = p.phone && alreadySent("billing", refKey, "sms", p.phone);
    const alreadyPush = alreadySent("billing", refKey, "push", `parent:${p.id}`);
    if (alreadyEmail && alreadySms && alreadyPush) continue;

    const text = `Hi ${p.name}, we weren't able to process this month's dues payment. Please update your card at your convenience so there's no interruption to classes. Questions? Reply here or email PFPkickboxingacademy@gmail.com.`;
    const results = await notifyParent(
      { ...p, email_opt_in: p.email_opt_in && !alreadyEmail, sms_opt_in: p.sms_opt_in && !alreadySms },
      { subject: "Payment issue on your PFP account", text },
      alreadyPush ? null : p.id
    );
    sent += logResults("billing", refKey, results);
  }
  return sent;
}

// CRM nurture: a lead gets one welcome message on creation, then one
// "still interested?" nudge if they're still sitting in "New" after a few
// days without anyone moving them along the pipeline. This is a light
// touch on purpose — real follow-up (calls, texts from staff) still
// happens through the admin lead board, not automation alone.
async function runLeadNurture(now) {
  let sent = 0;

  const fresh = db.prepare(`SELECT * FROM leads WHERE welcome_sent_at IS NULL`).all();
  for (const lead of fresh) {
    if (!lead.email && !lead.phone) continue;
    const text = `Hi ${lead.name}, thanks for your interest in PFP Kickboxing Academy${lead.program_interest ? ` (${lead.program_interest})` : ""}! We'll follow up shortly to get your free class on the calendar. Questions in the meantime? Email PFPkickboxingacademy@gmail.com.`;
    const results = await notifyParent(
      { email: lead.email, phone: lead.phone, email_opt_in: true, sms_opt_in: true },
      { subject: "Thanks for reaching out to PFP Kickboxing Academy!", text }
    );
    logResults("lead_nurture", `welcome:${lead.id}`, results);
    db.prepare(`UPDATE leads SET welcome_sent_at = datetime('now') WHERE id = ?`).run(lead.id);
    sent += results.length;
  }

  const stale = db
    .prepare(
      `SELECT * FROM leads WHERE stage = 'New' AND nudge_sent_at IS NULL AND welcome_sent_at IS NOT NULL
       AND julianday(?) - julianday(last_stage_change_at) >= ?`
    )
    .all(now.toISOString(), LEAD_NUDGE_DAYS);
  for (const lead of stale) {
    if (!lead.email && !lead.phone) continue;
    const text = `Hi ${lead.name}, still interested in trying a free class at PFP Kickboxing Academy? Reply here or call us and we'll get you on the schedule.`;
    const results = await notifyParent(
      { email: lead.email, phone: lead.phone, email_opt_in: true, sms_opt_in: true },
      { subject: "Still want to try a free class?", text }
    );
    logResults("lead_nurture", `nudge:${lead.id}`, results);
    db.prepare(`UPDATE leads SET nudge_sent_at = datetime('now') WHERE id = ?`).run(lead.id);
    sent += results.length;
  }

  return sent;
}

async function runReminderSweep() {
  const now = new Date();
  const [classCount, beltCount, eventCount, billingCount, leadCount] = await Promise.all([
    runClassReminders(now),
    runBeltTestReminders(now),
    runEventReminders(now),
    runBillingReminders(now),
    runLeadNurture(now),
  ]);
  const summary = { classCount, beltCount, eventCount, billingCount, leadCount, ranAt: now.toISOString() };
  console.log(`Reminder sweep complete:`, summary);
  return summary;
}

module.exports = { runReminderSweep };
