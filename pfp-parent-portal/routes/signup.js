const express = require("express");
const db = require("../db");
const { layout } = require("../views/layout");
const { startSubscriptionCheckout } = require("../services/billing");
const { hashPassword } = require("../services/auth");

const router = express.Router();

const FOUNDING_MEMBER_CAP = 10; // first 10 students total, across all 4 programs

function foundingMembersSoFar() {
  return db.prepare("SELECT COUNT(*) AS n FROM students WHERE is_founding_member = 1").get().n;
}

function programOptions() {
  const plans = db.prepare("SELECT * FROM plans").all();
  const byProgram = Object.fromEntries(plans.map((p) => [p.program, p]));
  const base = [
    { value: "Karate Cubs", label: "Karate Cubs (5-8)" },
    { value: "Lion Pride", label: "Lion Pride (9-12)" },
    { value: "Teens", label: "Teens Class (13+)" },
    { value: "Adults", label: "Cardio Kickboxing (Adults)" },
  ];
  return base.map((o) => {
    const plan = byProgram[o.value];
    const price = plan ? ` — $${(plan.monthly_price_cents / 100).toFixed(2)}/mo` : "";
    return { ...o, label: o.label + price };
  });
}

router.get("/", (req, res) => {
  const opts = programOptions()
    .map((o) => `<option value="${o.value}">${o.label}</option>`)
    .join("");

  const remainingFoundingSpots = Math.max(0, FOUNDING_MEMBER_CAP - foundingMembersSoFar());

  const body = `
    <span class="eyebrow">Get Started</span>
    <h1>Sign Your Family Up</h1>
    <p style="color:var(--muted);max-width:60ch;">Register once and we'll text and email you before every class, when your student is up for belt testing, and ahead of academy events. No more sticky notes on the fridge.</p>
    ${remainingFoundingSpots > 0 ? `<p class="flash" style="max-width:60ch;">&#9733; Founding Member offer: the first ${FOUNDING_MEMBER_CAP} families to sign up get a Founding Member badge. ${remainingFoundingSpots} spot${remainingFoundingSpots === 1 ? "" : "s"} left — price is $139/mo either way.</p>` : ""}
    <form class="card" method="POST" action="/signup">
      <h3 style="font-size:1.1rem;">Parent / Guardian</h3>
      <div class="grid-2">
        <div>
          <label for="parent_name">Your Name</label>
          <input type="text" id="parent_name" name="parent_name" required>
        </div>
        <div>
          <label for="parent_email">Email</label>
          <input type="email" id="parent_email" name="parent_email" required>
        </div>
      </div>
      <label for="parent_phone">Mobile Phone (for SMS reminders, e.g. +15185551234)</label>
      <input type="tel" id="parent_phone" name="parent_phone" placeholder="+15185551234">

      <div class="grid-2">
        <div>
          <label for="password">Create a Password</label>
          <input type="password" id="password" name="password" minlength="8" required autocomplete="new-password">
        </div>
        <div>
          <label for="confirm_password">Confirm Password</label>
          <input type="password" id="confirm_password" name="confirm_password" minlength="8" required autocomplete="new-password">
        </div>
      </div>
      <p style="color:var(--muted);font-size:0.8rem;margin-top:6px;">At least 8 characters. You'll use this to log in to the Parent Portal.</p>

      <div class="checkbox-row">
        <input type="checkbox" id="email_opt_in" name="email_opt_in" checked>
        <label for="email_opt_in">Send me email reminders</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="sms_opt_in" name="sms_opt_in" checked>
        <label for="sms_opt_in">Send me text reminders</label>
      </div>

      <h3 style="font-size:1.1rem;margin-top:28px;">Student</h3>
      <div class="grid-2">
        <div>
          <label for="student_name">Student Name</label>
          <input type="text" id="student_name" name="student_name" required>
        </div>
        <div>
          <label for="student_dob">Date of Birth</label>
          <input type="date" id="student_dob" name="student_dob">
        </div>
      </div>
      <label for="program">Program</label>
      <select id="program" name="program" required>${opts}</select>

      <button type="submit">Continue to Payment</button>
      <p style="color:var(--muted);font-size:0.8rem;margin-top:10px;">You'll be taken to secure Square checkout to set up monthly dues ($139/mo, every program). ${remainingFoundingSpots > 0 ? `Only ${remainingFoundingSpots} founding member spot${remainingFoundingSpots === 1 ? "" : "s"} left!` : ""}</p>
    </form>
  `;
  res.send(layout({ title: "Sign Up", active: "/signup", body }));
});

router.post("/", async (req, res) => {
  const {
    parent_name,
    parent_email,
    parent_phone,
    password,
    confirm_password,
    email_opt_in,
    sms_opt_in,
    student_name,
    student_dob,
    program,
  } = req.body;

  const fail = (message) =>
    res.send(
      layout({
        title: "Sign Up",
        active: "/signup",
        flash: { error: true, message },
        body: `<a class="btn secondary" href="/signup">Back to form</a>`,
      })
    );

  if (!parent_name || !parent_email || !student_name || !program || !password) {
    return fail("Please fill in all required fields.");
  }
  if (password.length < 8) return fail("Password must be at least 8 characters.");
  if (password !== confirm_password) return fail("Passwords don't match.");

  let parent = db.prepare("SELECT * FROM parents WHERE email = ?").get(parent_email);
  if (parent && parent.password_hash) {
    return fail("An account already exists for that email. Log in to the Parent Portal to add another student.");
  }

  const passwordHash = hashPassword(password);

  if (!parent) {
    const info = db
      .prepare(
        `INSERT INTO parents (name, email, phone, email_opt_in, sms_opt_in, password_hash) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(parent_name, parent_email, parent_phone || null, email_opt_in ? 1 : 0, sms_opt_in ? 1 : 0, passwordHash);
    parent = db.prepare("SELECT * FROM parents WHERE id = ?").get(info.lastInsertRowid);
  } else {
    // Pre-existing row with no password (only possible for accounts
    // created before login was added) — finish setting it up now.
    db.prepare(
      `UPDATE parents SET name=?, phone=?, email_opt_in=?, sms_opt_in=?, password_hash=? WHERE id=?`
    ).run(parent_name, parent_phone || null, email_opt_in ? 1 : 0, sms_opt_in ? 1 : 0, passwordHash, parent.id);
    parent = db.prepare("SELECT * FROM parents WHERE id = ?").get(parent.id);
  }

  // Log them in immediately — no separate login step right after signing up.
  req.session.parentId = parent.id;

  const whiteBelt = db.prepare("SELECT id FROM belt_curriculum WHERE order_index = 1").get();
  const plan = db.prepare("SELECT * FROM plans WHERE program = ?").get(program);
  const isFoundingMember = foundingMembersSoFar() < FOUNDING_MEMBER_CAP ? 1 : 0;

  const studentInfo = db
    .prepare(
      `INSERT INTO students (parent_id, name, dob, program, current_rank_id, plan_id, is_founding_member) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(parent.id, student_name, student_dob || null, program, whiteBelt ? whiteBelt.id : null, plan ? plan.id : null, isFoundingMember);
  const student = { id: studentInfo.lastInsertRowid, name: student_name, program };

  const classes = db.prepare("SELECT id FROM classes WHERE program = ?").all(program);
  const enroll = db.prepare("INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)");
  classes.forEach((c) => enroll.run(studentInfo.lastInsertRowid, c.id));

  // A lead may have converted straight into a full sign-up (e.g. after a
  // trial class) — mark it Enrolled and link it, rather than leaving it
  // stuck in the pipeline.
  db.prepare(
    `UPDATE leads SET stage = 'Enrolled', converted_parent_id = ?, last_stage_change_at = datetime('now') WHERE email = ? AND stage != 'Enrolled'`
  ).run(parent.id, parent_email);

  if (!plan) {
    const body = `
      <h1>You're All Set!</h1>
      <p style="color:var(--muted);max-width:60ch;">${student_name} is enrolled in ${program}. No billing plan exists for that program yet, so no payment was requested — an admin needs to add one under Admin &gt; Plans.</p>
      <a class="btn" href="/portal/dashboard">Go to Parent Portal</a>
    `;
    return res.send(layout({ title: "Signed Up", active: "/signup", body }));
  }

  const foundingBadge = isFoundingMember
    ? `<p style="color:var(--ice);">&#9733; ${student_name} is a Founding Member!</p>`
    : "";

  try {
    const result = await startSubscriptionCheckout({ parent, plan, student });
    if (result.dryRun) {
      db.prepare(`UPDATE parents SET billing_status = 'active' WHERE id = ?`).run(parent.id);
      const body = `
        <h1>You're All Set!</h1>
        <p style="color:var(--muted);max-width:60ch;">${student_name} is enrolled in ${program} ($${(plan.monthly_price_cents / 100).toFixed(2)}/mo).</p>
        ${foundingBadge}
        <p class="flash">Square isn't connected yet, so this is running in dry-run mode: billing was marked active without actually charging a card. Add SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID to go live with real payments.</p>
        <a class="btn" href="/portal/dashboard">Go to Parent Portal</a>
      `;
      return res.send(layout({ title: "Signed Up", active: "/signup", body }));
    }
    return res.redirect(result.checkoutUrl);
  } catch (err) {
    console.error("Square checkout failed:", err);
    const body = `
      <h1>Almost There</h1>
      <p style="color:var(--muted);max-width:60ch;">${student_name} is enrolled in ${program}, but we couldn't start checkout (${err.message}). An admin has been notified — reach out to PFPkickboxingacademy@gmail.com to finish setting up billing.</p>
      ${foundingBadge}
      <a class="btn" href="/portal/dashboard">Go to Parent Portal</a>
    `;
    res.send(layout({ title: "Signed Up", active: "/signup", body }));
  }
});

module.exports = router;
