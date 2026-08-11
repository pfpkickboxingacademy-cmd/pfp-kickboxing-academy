const express = require("express");
const db = require("../db");
const { layout } = require("../views/layout");
const { createBillingPortalSession } = require("../services/billing");
const { verifyPassword, requireParentLogin, sendPasswordResetEmail, consumeResetToken, hashPassword } = require("../services/auth");

const router = express.Router();

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const BILLING_COPY = {
  active: { label: "Active", color: "#9be6b3", border: "#3fbf6a" },
  past_due: { label: "Payment Issue", color: "var(--ice)", border: "var(--red)" },
  canceled: { label: "Canceled", color: "var(--muted)", border: "var(--line)" },
  no_plan: { label: "No Plan Yet", color: "var(--muted)", border: "var(--line)" },
};

// --- Login ---------------------------------------------------------------

router.get("/", (req, res) => {
  if (req.session && req.session.parentId) return res.redirect("/portal/dashboard");

  const body = `
    <span class="eyebrow">Family Login</span>
    <h1>Parent Portal</h1>
    <p style="color:var(--muted);max-width:60ch;">Log in to view your student's schedule, belt progress, and billing.</p>
    <form class="card" method="POST" action="/portal/login">
      <input type="hidden" name="next" value="${(req.query.next || "").replace(/"/g, "&quot;")}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required placeholder="you@example.com">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Log In</button>
      <p style="margin-top:14px;"><a href="/portal/forgot">Forgot your password?</a></p>
    </form>
    <p style="color:var(--muted);font-size:0.85rem;">New here? <a href="/signup">Sign up</a> to create a family account.</p>
    <p style="color:var(--muted);font-size:0.85rem;">Try the seeded demo account: <code>demo.parent@example.com</code> / <code>demo1234</code></p>
  `;
  res.send(layout({ title: "Parent Portal", active: "/portal", body }));
});

router.post("/login", (req, res) => {
  const { email, password, next } = req.body;
  const parent = db.prepare("SELECT * FROM parents WHERE email = ?").get(email);

  if (!parent || !verifyPassword(password, parent.password_hash)) {
    return res.send(
      layout({
        title: "Parent Portal",
        active: "/portal",
        flash: { error: true, message: "Incorrect email or password." },
        body: `<a class="btn secondary" href="/portal">Back to login</a>`,
      })
    );
  }

  req.session.parentId = parent.id;
  res.redirect(next && next.startsWith("/") ? next : "/portal/dashboard");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/portal"));
});

// --- Forgot / reset password ---------------------------------------------

router.get("/forgot", (req, res) => {
  const body = `
    <span class="eyebrow">Family Login</span>
    <h1>Reset Your Password</h1>
    <form class="card" method="POST" action="/portal/forgot">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required>
      <button type="submit">Send Reset Link</button>
    </form>
  `;
  res.send(layout({ title: "Forgot Password", active: "/portal", body }));
});

router.post("/forgot", async (req, res) => {
  const { email } = req.body;
  const parent = db.prepare("SELECT * FROM parents WHERE email = ?").get(email);
  // Always show the same message whether or not the account exists, so this
  // can't be used to check which emails have accounts.
  if (parent) await sendPasswordResetEmail(parent);

  const body = `
    <h1>Check Your Email</h1>
    <p style="color:var(--muted);max-width:60ch;">If an account exists for ${email ? email.replace(/</g, "&lt;") : "that address"}, a password reset link is on its way. It expires in 30 minutes.</p>
    <a class="btn secondary" href="/portal">Back to login</a>
  `;
  res.send(layout({ title: "Check Your Email", active: "/portal", body }));
});

router.get("/reset", (req, res) => {
  const { token } = req.query;
  const row = consumeResetToken(token);
  if (!row) {
    const body = `<h1>Link Expired</h1><p style="color:var(--muted);">This reset link is invalid or has expired. <a href="/portal/forgot">Request a new one</a>.</p>`;
    return res.send(layout({ title: "Reset Password", active: "/portal", body }));
  }

  const body = `
    <h1>Choose a New Password</h1>
    <form class="card" method="POST" action="/portal/reset">
      <input type="hidden" name="token" value="${token}">
      <label for="password">New Password</label>
      <input type="password" id="password" name="password" minlength="8" required>
      <label for="confirm_password">Confirm New Password</label>
      <input type="password" id="confirm_password" name="confirm_password" minlength="8" required>
      <button type="submit">Set New Password</button>
    </form>
  `;
  res.send(layout({ title: "Reset Password", active: "/portal", body }));
});

router.post("/reset", (req, res) => {
  const { token, password, confirm_password } = req.body;
  const row = consumeResetToken(token);
  if (!row) {
    const body = `<h1>Link Expired</h1><p style="color:var(--muted);">This reset link is invalid or has expired. <a href="/portal/forgot">Request a new one</a>.</p>`;
    return res.send(layout({ title: "Reset Password", active: "/portal", body }));
  }
  if (!password || password.length < 8 || password !== confirm_password) {
    const body = `<h1>Passwords Didn't Match</h1><p style="color:var(--muted);">Make sure both fields match and are at least 8 characters. <a href="/portal/reset?token=${token}">Try again</a>.</p>`;
    return res.send(layout({ title: "Reset Password", active: "/portal", body }));
  }

  db.prepare(`UPDATE parents SET password_hash = ? WHERE id = ?`).run(hashPassword(password), row.parent_id);
  db.prepare(`UPDATE password_resets SET used = 1 WHERE id = ?`).run(row.id);
  req.session.parentId = row.parent_id;

  res.redirect("/portal/dashboard");
});

// --- Dashboard (requires login) -------------------------------------------

router.get("/dashboard", requireParentLogin, (req, res) => {
  const parent = req.parent;
  const { billing } = req.query;

  let flash = null;
  if (billing === "success") flash = { message: "Payment method saved — you're all set for automatic monthly billing." };
  if (billing === "canceled") flash = { error: true, message: "Checkout was canceled, so billing isn't set up yet. You can try again below." };
  if (billing === "portal_dry_run")
    flash = { message: "Stripe isn't connected yet, so there's no real card on file to manage — this works automatically once real Stripe keys are added." };

  const students = db.prepare("SELECT * FROM students WHERE parent_id = ?").all(parent.id);

  const studentCards = students
    .map((s) => {
      const rank = s.current_rank_id
        ? db.prepare("SELECT * FROM belt_curriculum WHERE id = ?").get(s.current_rank_id)
        : null;
      const classes = db
        .prepare(
          `SELECT c.* FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id = ? ORDER BY c.day_of_week, c.start_time`
        )
        .all(s.id);
      const scheduleRows = classes
        .map((c) => `<tr><td>${DAY_NAMES[c.day_of_week]}</td><td>${c.name}</td><td>${c.start_time} - ${c.end_time}</td></tr>`)
        .join("");
      const pct = rank ? Math.min(100, Math.round((s.classes_attended_at_rank / rank.classes_required) * 100)) : 0;

      return `
        <div class="card">
          <span class="tag">${s.program}</span>
          <h3 style="font-size:1.3rem;">${s.name}</h3>
          ${
            rank
              ? `<p style="color:var(--muted);margin:4px 0;">Current rank: <strong style="color:var(--white);">${rank.rank_name}</strong></p>
                 <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
                 <p style="color:var(--muted);font-size:0.8rem;margin-top:6px;">${s.classes_attended_at_rank} / ${rank.classes_required} classes toward next test</p>
                 ${s.eligible_for_test ? `<p style="color:var(--ice);margin-top:8px;">&#9733; Eligible for belt testing!</p>` : ""}
                 ${s.test_date ? `<p style="color:var(--muted);font-size:0.85rem;">Test scheduled: ${s.test_date}</p>` : ""}`
              : ""
          }
          <table><thead><tr><th>Day</th><th>Class</th><th>Time</th></tr></thead><tbody>${scheduleRows || `<tr><td colspan="3" style="color:var(--muted);">Not enrolled in any classes yet.</td></tr>`}</tbody></table>
        </div>
      `;
    })
    .join("");

  const events = db
    .prepare(`SELECT * FROM events WHERE event_date >= date('now') ORDER BY event_date LIMIT 5`)
    .all();
  const eventRows = events
    .map((e) => `<tr><td>${e.event_date}${e.event_time ? " " + e.event_time : ""}</td><td>${e.title}</td><td>${e.location || ""}</td></tr>`)
    .join("");

  const billingInfo = BILLING_COPY[parent.billing_status] || BILLING_COPY.no_plan;

  const body = `
    <span class="eyebrow">Welcome back</span>
    <h1>${parent.name}'s Dashboard</h1>
    <p style="color:var(--muted);">Reminders go to ${parent.email_opt_in ? parent.email : "(email off)"}${parent.sms_opt_in && parent.phone ? ` and ${parent.phone}` : ""}. <a href="/portal/logout">Log out</a></p>

    <div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <strong>Billing: <span class="pill" style="border-color:${billingInfo.border};color:${billingInfo.color};">${billingInfo.label}</span></strong>
        <p style="color:var(--muted);font-size:0.85rem;margin:4px 0 0;">Dues are charged automatically each month to the card on file. Update your card or view past charges anytime.</p>
      </div>
      <form method="GET" action="/portal/manage-billing" style="margin:0;">
        <button type="submit" style="margin:0;">Manage Billing</button>
      </form>
    </div>

    <div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <strong>Install the App</strong>
        <p style="color:var(--muted);font-size:0.85rem;margin:4px 0 0;">Add PFP to your home screen and turn on push notifications for class, belt test, and event reminders.</p>
      </div>
      <button type="button" onclick="PFP.enablePush(this)">Enable Push Notifications</button>
    </div>

    ${studentCards || `<p style="color:var(--muted);">No students on file yet.</p>`}
    <div class="card">
      <h3 style="font-size:1.1rem;">Upcoming Events</h3>
      <table><thead><tr><th>Date</th><th>Event</th><th>Location</th></tr></thead><tbody>${eventRows || `<tr><td colspan="3" style="color:var(--muted);">No events scheduled.</td></tr>`}</tbody></table>
    </div>
  `;
  res.send(layout({ title: "Dashboard", active: "/portal", flash, body }));
});

router.get("/manage-billing", requireParentLogin, async (req, res) => {
  const result = await createBillingPortalSession({ parent: req.parent });
  if (result.dryRun) {
    return res.redirect(`/portal/dashboard?billing=portal_dry_run`);
  }
  res.redirect(result.portalUrl);
});

module.exports = router;
