const express = require("express");
const db = require("../db");
const { layout } = require("../views/layout");
const { runReminderSweep } = require("../services/reminders");
const { sendEmail, sendSMS } = require("../services/notify");

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

// Basic auth gate for every /admin route.
router.use((req, res, next) => {
  const header = req.headers.authorization;
  if (header) {
    const [, encoded] = header.split(" ");
    const [, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (pass === ADMIN_PASSWORD) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="PFP Admin"');
  res.status(401).send("Authentication required.");
});

const BILLING_LABEL = {
  active: `<span class="pill" style="border-color:#3fbf6a;color:#9be6b3;">Active</span>`,
  past_due: `<span class="pill" style="border-color:var(--red);color:var(--ice);">Past Due</span>`,
  canceled: `<span class="pill" style="color:var(--muted);">Canceled</span>`,
  no_plan: `<span class="pill" style="color:var(--muted);">No Plan</span>`,
};

function adminNav(active) {
  const items = [
    ["/admin", "Dashboard"],
    ["/admin/leads", "Leads (CRM)"],
    ["/admin/plans", "Billing Plans"],
    ["/admin/announcements", "Announcements"],
  ];
  return `<div style="margin-bottom:24px;">${items
    .map(
      ([href, label]) =>
        `<a class="btn ${active === href ? "" : "secondary"}" style="margin:0 8px 0 0;padding:9px 16px;font-size:0.75rem;" href="${href}">${label}</a>`
    )
    .join("")}</div>`;
}

router.get("/", (req, res) => {
  const students = db
    .prepare(
      `SELECT s.*, s.is_founding_member, p.name AS parent_name, p.email, p.phone, p.billing_status, bc.rank_name, bc.classes_required
       FROM students s
       JOIN parents p ON p.id = s.parent_id
       LEFT JOIN belt_curriculum bc ON bc.id = s.current_rank_id
       ORDER BY s.name`
    )
    .all();

  const rows = students
    .map(
      (s) => `
      <tr>
        <td>${s.name}${s.is_founding_member ? ` <span class="pill" style="border-color:var(--ice);color:var(--ice);font-size:0.65rem;">&#9733; Founding</span>` : ""}<br><span style="color:var(--muted);font-size:0.8rem;">${s.program}</span></td>
        <td>${s.parent_name}<br><span style="color:var(--muted);font-size:0.8rem;">${s.email}${s.phone ? " · " + s.phone : ""}</span></td>
        <td>${BILLING_LABEL[s.billing_status] || s.billing_status}</td>
        <td>${s.rank_name || "-"}</td>
        <td>${s.classes_attended_at_rank}${s.classes_required ? " / " + s.classes_required : ""} ${s.eligible_for_test ? `<span class="pill" style="border-color:var(--red);color:var(--ice);">Eligible</span>` : ""}</td>
        <td>
          <form method="POST" action="/admin/students/${s.id}/log-class" style="display:inline;">
            <button type="submit" style="margin:0;padding:6px 12px;font-size:0.7rem;">+1 Class</button>
          </form>
          <form method="POST" action="/admin/students/${s.id}/test-date" style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;">
            <input type="date" name="test_date" value="${s.test_date || ""}" style="width:150px;padding:6px 8px;">
            <button type="submit" style="margin:0;padding:6px 12px;font-size:0.7rem;">Set Test Date</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const events = db.prepare(`SELECT * FROM events ORDER BY event_date`).all();
  const eventRows = events
    .map((e) => `<tr><td>${e.event_date}${e.event_time ? " " + e.event_time : ""}</td><td>${e.title}</td><td>${e.location || ""}</td></tr>`)
    .join("");

  const recentLog = db
    .prepare(`SELECT * FROM reminder_log ORDER BY sent_at DESC LIMIT 15`)
    .all();
  const logRows = recentLog
    .map(
      (l) =>
        `<tr><td>${l.sent_at}</td><td>${l.reminder_type}</td><td>${l.channel}${l.dry_run ? " (dry run)" : ""}</td><td>${l.recipient}</td></tr>`
    )
    .join("");

  const body = `
    <span class="eyebrow">Staff Only</span>
    <h1>Admin Dashboard</h1>
    ${adminNav("/admin")}

    <div class="card">
      <h3 style="font-size:1.1rem;">Reminder Engine</h3>
      <p style="color:var(--muted);">Runs automatically on a schedule (see cron.js). Trigger it manually to test class, belt, event, and past-due billing reminders.</p>
      <form method="POST" action="/admin/run-reminders">
        <button type="submit">Run Reminders Now</button>
      </form>
    </div>

    <div class="card">
      <h3 style="font-size:1.1rem;">Roster, Billing & Belt Tracking</h3>
      <table>
        <thead><tr><th>Student</th><th>Parent</th><th>Billing</th><th>Rank</th><th>Progress</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="color:var(--muted);">No students yet.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="card">
      <h3 style="font-size:1.1rem;">Events</h3>
      <table>
        <thead><tr><th>Date</th><th>Title</th><th>Location</th></tr></thead>
        <tbody>${eventRows || `<tr><td colspan="3" style="color:var(--muted);">No events yet.</td></tr>`}</tbody>
      </table>
      <form method="POST" action="/admin/events" style="margin-top:16px;">
        <div class="grid-2">
          <div><label>Title</label><input type="text" name="title" required></div>
          <div><label>Date</label><input type="date" name="event_date" required></div>
        </div>
        <div class="grid-2">
          <div><label>Time</label><input type="text" name="event_time" placeholder="18:00"></div>
          <div><label>Location</label><input type="text" name="location" placeholder="PFP Kickboxing Academy"></div>
        </div>
        <label>Description</label>
        <textarea name="description" rows="2"></textarea>
        <button type="submit">Add Event</button>
      </form>
    </div>

    <div class="card">
      <h3 style="font-size:1.1rem;">Recent Reminder Activity</h3>
      <table>
        <thead><tr><th>Sent At</th><th>Type</th><th>Channel</th><th>Recipient</th></tr></thead>
        <tbody>${logRows || `<tr><td colspan="4" style="color:var(--muted);">Nothing sent yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  res.send(layout({ title: "Admin", active: "/admin", body }));
});

router.post("/students/:id/log-class", (req, res) => {
  db.prepare(`UPDATE students SET classes_attended_at_rank = classes_attended_at_rank + 1 WHERE id = ?`).run(
    req.params.id
  );
  res.redirect("/admin");
});

router.post("/students/:id/test-date", (req, res) => {
  db.prepare(`UPDATE students SET test_date = ? WHERE id = ?`).run(req.body.test_date || null, req.params.id);
  res.redirect("/admin");
});

router.post("/events", (req, res) => {
  const { title, description, event_date, event_time, location } = req.body;
  if (title && event_date) {
    db.prepare(
      `INSERT INTO events (title, description, event_date, event_time, location) VALUES (?, ?, ?, ?, ?)`
    ).run(title, description || null, event_date, event_time || null, location || null);
  }
  res.redirect("/admin");
});

router.post("/run-reminders", async (req, res) => {
  await runReminderSweep();
  res.redirect("/admin");
});

// --- Billing Plans -----------------------------------------------------

router.get("/plans", (req, res) => {
  const plans = db.prepare(`SELECT * FROM plans ORDER BY program`).all();
  const rows = plans
    .map(
      (p) => `
      <tr>
        <td>${p.program}</td>
        <td>
          <form method="POST" action="/admin/plans/${p.id}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" name="name" value="${p.name}" style="width:180px;padding:6px 8px;">
            <input type="number" name="monthly_price_usd" value="${(p.monthly_price_cents / 100).toFixed(2)}" step="0.01" style="width:100px;padding:6px 8px;">
            <input type="text" name="square_plan_variation_id" value="${p.square_plan_variation_id || ""}" placeholder="auto-filled on first live checkout" style="width:260px;padding:6px 8px;">
            <button type="submit" style="margin:0;padding:6px 12px;font-size:0.7rem;">Save</button>
          </form>
        </td>
      </tr>`
    )
    .join("");

  const body = `
    <span class="eyebrow">Staff Only</span>
    <h1>Billing Plans</h1>
    ${adminNav("/admin/plans")}
    <div class="card">
      <p style="color:var(--muted);">One monthly plan per program — all four are $139/mo. The Square subscription plan variation ID is created and filled in automatically the first time someone checks out live (see services/billing.js); you only need to touch it if something needs to be re-pointed at a different Square Catalog object.</p>
      <table>
        <thead><tr><th>Program</th><th>Name / Price / Square Plan Variation ID</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="2" style="color:var(--muted);">No plans yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  res.send(layout({ title: "Billing Plans", active: "/admin", body }));
});

router.post("/plans/:id", (req, res) => {
  const { name, monthly_price_usd, square_plan_variation_id } = req.body;
  const cents = Math.round(Number(monthly_price_usd || 0) * 100);
  db.prepare(`UPDATE plans SET name = ?, monthly_price_cents = ?, square_plan_variation_id = ? WHERE id = ?`).run(
    name,
    cents,
    square_plan_variation_id || null,
    req.params.id
  );
  res.redirect("/admin/plans");
});

// --- Announcements ---------------------------------------------------------
// One-off broadcast to every signed-up parent (distinct from the automated,
// trigger-based reminders in services/reminders.js). Respects each parent's
// email/SMS opt-in, and logs to reminder_log (type 'announcement') so the
// activity shows up in the admin log alongside everything else.

router.get("/announcements", (req, res) => {
  const recent = db
    .prepare(`SELECT * FROM reminder_log WHERE reminder_type = 'announcement' ORDER BY sent_at DESC LIMIT 20`)
    .all();
  const recentRows = recent
    .map((l) => `<tr><td>${l.sent_at}</td><td>${l.channel}${l.dry_run ? " (dry run)" : ""}</td><td>${l.recipient}</td></tr>`)
    .join("");
  const parentCount = db.prepare("SELECT COUNT(*) AS n FROM parents").get().n;

  const body = `
    <span class="eyebrow">Staff Only</span>
    <h1>Announcements</h1>
    ${adminNav("/admin/announcements")}
    <div class="card">
      <h3 style="font-size:1.1rem;">Send an Update to All Parents</h3>
      <p style="color:var(--muted);">Goes out by email and text to every one of the ${parentCount} signed-up families who have that channel enabled — right now, once, not on a recurring schedule.</p>
      <form method="POST" action="/admin/announcements">
        <label>Subject</label>
        <input type="text" name="subject" required placeholder="Schedule change this week">
        <label>Message</label>
        <textarea name="message" rows="5" required placeholder="Hi families, ..."></textarea>
        <button type="submit">Send to All Parents</button>
      </form>
    </div>
    <div class="card">
      <h3 style="font-size:1.1rem;">Recent Announcements</h3>
      <table>
        <thead><tr><th>Sent At</th><th>Channel</th><th>Recipient</th></tr></thead>
        <tbody>${recentRows || `<tr><td colspan="3" style="color:var(--muted);">Nothing sent yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  res.send(layout({ title: "Announcements", active: "/admin", body }));
});

router.post("/announcements", async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) return res.redirect("/admin/announcements");

  const broadcastKey = `broadcast:${Date.now()}`;
  const parents = db.prepare("SELECT * FROM parents").all();
  let sentCount = 0;

  for (const p of parents) {
    if (p.email_opt_in && p.email) {
      const result = await sendEmail({ to: p.email, subject, text: message });
      db.prepare(
        `INSERT OR IGNORE INTO reminder_log (reminder_type, reference_key, channel, recipient, dry_run) VALUES ('announcement', ?, 'email', ?, ?)`
      ).run(broadcastKey, p.email, result.dryRun ? 1 : 0);
      sentCount++;
    }
    if (p.sms_opt_in && p.phone) {
      const result = await sendSMS({ to: p.phone, body: `${subject}\n\n${message}` });
      db.prepare(
        `INSERT OR IGNORE INTO reminder_log (reminder_type, reference_key, channel, recipient, dry_run) VALUES ('announcement', ?, 'sms', ?, ?)`
      ).run(broadcastKey, p.phone, result.dryRun ? 1 : 0);
      sentCount++;
    }
  }

  console.log(`[ANNOUNCEMENT] "${subject}" sent to ${sentCount} channel(s) across ${parents.length} parent(s).`);
  res.redirect("/admin/announcements");
});

// --- CRM: Leads ----------------------------------------------------------

const STAGES = ["New", "Trial Booked", "Trial Attended", "Enrolled", "Lost"];

router.get("/leads", (req, res) => {
  const leads = db.prepare(`SELECT * FROM leads ORDER BY last_stage_change_at DESC`).all();

  const columns = STAGES.map((stage) => {
    const inStage = leads.filter((l) => l.stage === stage);
    const cards = inStage
      .map(
        (l) => `
        <div class="card" style="padding:14px;margin-bottom:10px;">
          <strong>${l.name}</strong><br>
          <span style="color:var(--muted);font-size:0.8rem;">${l.program_interest || ""}${l.source ? " · " + l.source : ""}</span>
          <p style="font-size:0.8rem;color:var(--muted);margin:8px 0;">${l.email || ""}${l.phone ? " · " + l.phone : ""}</p>
          ${l.notes ? `<p style="font-size:0.8rem;margin:8px 0;">${l.notes}</p>` : ""}
          <form method="POST" action="/admin/leads/${l.id}/stage" style="display:flex;gap:6px;">
            <select name="stage" style="padding:6px 8px;font-size:0.75rem;">
              ${STAGES.map((s) => `<option value="${s}" ${s === l.stage ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            <button type="submit" style="margin:0;padding:6px 10px;font-size:0.7rem;">Move</button>
          </form>
        </div>`
      )
      .join("");
    return `
      <div>
        <h3 style="font-size:0.95rem;color:var(--muted);">${stage} (${inStage.length})</h3>
        ${cards || `<p style="color:var(--muted);font-size:0.8rem;">Empty</p>`}
      </div>`;
  }).join("");

  const body = `
    <span class="eyebrow">Staff Only</span>
    <h1>Lead Pipeline</h1>
    ${adminNav("/admin/leads")}

    <div class="card">
      <h3 style="font-size:1.1rem;">Add a Lead</h3>
      <form method="POST" action="/admin/leads">
        <div class="grid-2">
          <div><label>Name</label><input type="text" name="name" required></div>
          <div><label>Program Interest</label><input type="text" name="program_interest" placeholder="Lion Pride"></div>
        </div>
        <div class="grid-2">
          <div><label>Email</label><input type="email" name="email"></div>
          <div><label>Phone</label><input type="tel" name="phone"></div>
        </div>
        <label>Source</label>
        <input type="text" name="source" placeholder="Website form, Referral, Walk-in...">
        <label>Notes</label>
        <textarea name="notes" rows="2"></textarea>
        <button type="submit">Add Lead</button>
      </form>
    </div>

    <div class="card">
      <h3 style="font-size:1.1rem;">Pipeline</h3>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;overflow-x:auto;">
        ${columns}
      </div>
    </div>
  `;
  res.send(layout({ title: "Leads", active: "/admin", body }));
});

router.post("/leads", (req, res) => {
  const { name, email, phone, program_interest, source, notes } = req.body;
  if (name) {
    db.prepare(
      `INSERT INTO leads (name, email, phone, program_interest, source, notes) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, email || null, phone || null, program_interest || null, source || null, notes || null);
  }
  res.redirect("/admin/leads");
});

router.post("/leads/:id/stage", (req, res) => {
  const { stage } = req.body;
  if (STAGES.includes(stage)) {
    db.prepare(`UPDATE leads SET stage = ?, last_stage_change_at = datetime('now') WHERE id = ?`).run(
      stage,
      req.params.id
    );
  }
  res.redirect("/admin/leads");
});

module.exports = router;
