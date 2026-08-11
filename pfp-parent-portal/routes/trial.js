// Public-facing lead capture ("book a free class"). This is the top of the
// CRM funnel: anyone who fills this out lands in the admin Lead Pipeline
// at the "New" stage, gets an automatic welcome message, and staff moves
// them through Trial Booked -> Trial Attended -> Enrolled/Lost from there.

const express = require("express");
const db = require("../db");
const { layout } = require("../views/layout");

const router = express.Router();

router.get("/", (req, res) => {
  const body = `
    <span class="eyebrow">No Commitment</span>
    <h1>Try a Free Class</h1>
    <p style="color:var(--muted);max-width:60ch;">Tell us a bit about your student and we'll reach out to get a free trial class on the calendar.</p>
    <form class="card" method="POST" action="/trial">
      <label for="name">Your Name</label>
      <input type="text" id="name" name="name" required>
      <div class="grid-2">
        <div><label for="email">Email</label><input type="email" id="email" name="email"></div>
        <div><label for="phone">Phone</label><input type="tel" id="phone" name="phone"></div>
      </div>
      <label for="program_interest">Interested In</label>
      <select id="program_interest" name="program_interest">
        <option value="Karate Cubs">Karate Cubs (5-8)</option>
        <option value="Lion Pride">Lion Pride (9-12)</option>
        <option value="Teens">Teens Class (13+)</option>
        <option value="Adults">Cardio Kickboxing (Adults)</option>
      </select>
      <label for="notes">Anything we should know?</label>
      <textarea id="notes" name="notes" rows="2"></textarea>
      <button type="submit">Request My Free Class</button>
    </form>
  `;
  res.send(layout({ title: "Free Class", active: "/trial", body }));
});

router.post("/", (req, res) => {
  const { name, email, phone, program_interest, notes } = req.body;
  if (!name || (!email && !phone)) {
    return res.send(
      layout({
        title: "Free Class",
        active: "/trial",
        flash: { error: true, message: "Please share your name and at least an email or phone number." },
        body: `<a class="btn secondary" href="/trial">Back to form</a>`,
      })
    );
  }

  db.prepare(
    `INSERT INTO leads (name, email, phone, program_interest, source, notes) VALUES (?, ?, ?, ?, 'Website form', ?)`
  ).run(name, email || null, phone || null, program_interest || null, notes || null);

  const body = `
    <h1>You're On the List!</h1>
    <p style="color:var(--muted);max-width:60ch;">Thanks, ${name}! We'll be in touch shortly to schedule your free class.</p>
  `;
  res.send(layout({ title: "Request Received", active: "/trial", body }));
});

module.exports = router;
