// Seeds the database with PFP Kickboxing Academy's real weekly schedule
// (from the site's schedule.html) plus a starter belt curriculum and a
// couple of demo events, so the prototype is populated with real data.
// Safe to re-run: skips seeding anything that's already there.

const db = require("./index");
const { hashPassword } = require("../services/auth");

function seedClasses() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM classes").get().n;
  if (count > 0) return console.log("Classes already seeded, skipping.");

  const insert = db.prepare(`
    INSERT INTO classes (name, program, day_of_week, start_time, end_time, age_range)
    VALUES (@name, @program, @day_of_week, @start_time, @end_time, @age_range)
  `);

  // day_of_week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const rows = [
    // Karate Cubs — Mon / Wed / Thu, 4:00-4:30pm
    { name: "Karate Cubs", program: "Karate Cubs", day_of_week: 1, start_time: "16:00", end_time: "16:30", age_range: "5-8" },
    { name: "Karate Cubs", program: "Karate Cubs", day_of_week: 3, start_time: "16:00", end_time: "16:30", age_range: "5-8" },
    { name: "Karate Cubs", program: "Karate Cubs", day_of_week: 4, start_time: "16:00", end_time: "16:30", age_range: "5-8" },
    // Lion Pride — Mon / Wed / Thu, 4:40-5:10pm
    { name: "Lion Pride", program: "Lion Pride", day_of_week: 1, start_time: "16:40", end_time: "17:10", age_range: "9-12" },
    { name: "Lion Pride", program: "Lion Pride", day_of_week: 3, start_time: "16:40", end_time: "17:10", age_range: "9-12" },
    { name: "Lion Pride", program: "Lion Pride", day_of_week: 4, start_time: "16:40", end_time: "17:10", age_range: "9-12" },
    // Teens Class — Tue / Thu / Fri, 5:20-6:05pm
    { name: "Teens Class", program: "Teens", day_of_week: 2, start_time: "17:20", end_time: "18:05", age_range: "13+" },
    { name: "Teens Class", program: "Teens", day_of_week: 4, start_time: "17:20", end_time: "18:05", age_range: "13+" },
    { name: "Teens Class", program: "Teens", day_of_week: 5, start_time: "17:20", end_time: "18:05", age_range: "13+" },
    // Cardio Kickboxing — Tue / Thu / Fri, 6:15-7:00pm
    { name: "Cardio Kickboxing", program: "Adults", day_of_week: 2, start_time: "18:15", end_time: "19:00", age_range: "Adults" },
    { name: "Cardio Kickboxing", program: "Adults", day_of_week: 4, start_time: "18:15", end_time: "19:00", age_range: "Adults" },
    { name: "Cardio Kickboxing", program: "Adults", day_of_week: 5, start_time: "18:15", end_time: "19:00", age_range: "Adults" },
  ];

  const insertMany = db.transaction((items) => items.forEach((r) => insert.run(r)));
  insertMany(rows);
  console.log(`Seeded ${rows.length} weekly class sessions.`);
}

function seedBeltCurriculum() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM belt_curriculum").get().n;
  if (count > 0) return console.log("Belt curriculum already seeded, skipping.");

  // Placeholder rank order/classes-required — swap for PFP's real curriculum
  // once Tyreeke confirms it (see README "Before this goes live").
  const ranks = [
    { rank_name: "White Belt", order_index: 1, classes_required: 20 },
    { rank_name: "Yellow Belt", order_index: 2, classes_required: 20 },
    { rank_name: "Orange Belt", order_index: 3, classes_required: 24 },
    { rank_name: "Green Belt", order_index: 4, classes_required: 24 },
    { rank_name: "Blue Belt", order_index: 5, classes_required: 28 },
    { rank_name: "Purple Belt", order_index: 6, classes_required: 28 },
    { rank_name: "Brown Belt", order_index: 7, classes_required: 32 },
    { rank_name: "Black Belt", order_index: 8, classes_required: 40 },
  ];
  const insert = db.prepare(`
    INSERT INTO belt_curriculum (rank_name, order_index, classes_required)
    VALUES (@rank_name, @order_index, @classes_required)
  `);
  const insertMany = db.transaction((items) => items.forEach((r) => insert.run(r)));
  insertMany(ranks);
  console.log(`Seeded ${ranks.length} belt ranks.`);
}

function seedEvents() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  if (count > 0) return console.log("Events already seeded, skipping.");

  const today = new Date();
  const in14 = new Date(today.getTime() + 14 * 86400000);
  const in30 = new Date(today.getTime() + 30 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const insert = db.prepare(`
    INSERT INTO events (title, description, event_date, event_time, location)
    VALUES (@title, @description, @event_date, @event_time, @location)
  `);
  const rows = [
    {
      title: "Belt Testing Day",
      description: "Quarterly belt promotion testing for all eligible students.",
      event_date: fmt(in14),
      event_time: "17:00",
      location: "PFP Kickboxing Academy, Clifton Park Center",
    },
    {
      title: "Family Fun Tournament Night",
      description: "Friendly in-house point-sparring tournament for students and families.",
      event_date: fmt(in30),
      event_time: "18:00",
      location: "PFP Kickboxing Academy, Clifton Park Center",
    },
  ];
  const insertMany = db.transaction((items) => items.forEach((r) => insert.run(r)));
  insertMany(rows);
  console.log(`Seeded ${rows.length} demo events.`);
}

function seedPlans() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM plans").get().n;
  if (count > 0) return console.log("Plans already seeded, skipping.");

  // Placeholder monthly dues — swap for PFP's real pricing, and fill in
  // stripe_price_id (via admin > Plans) once the matching Stripe Price
  // exists, before going live with real billing.
  const rows = [
    { program: "Karate Cubs", name: "Karate Cubs Monthly", monthly_price_cents: 12900 },
    { program: "Lion Pride", name: "Lion Pride Monthly", monthly_price_cents: 12900 },
    { program: "Teens", name: "Teens Monthly", monthly_price_cents: 14900 },
    { program: "Adults", name: "Cardio Kickboxing Monthly", monthly_price_cents: 14900 },
  ];
  const insert = db.prepare(
    `INSERT INTO plans (program, name, monthly_price_cents) VALUES (@program, @name, @monthly_price_cents)`
  );
  const insertMany = db.transaction((items) => items.forEach((r) => insert.run(r)));
  insertMany(rows);
  console.log(`Seeded ${rows.length} billing plans (placeholder pricing — update in admin > Plans).`);
}

function seedDemoFamily() {
  const existing = db.prepare("SELECT id FROM parents WHERE email = ?").get("demo.parent@example.com");
  if (existing) return console.log("Demo family already seeded, skipping.");

  const parent = db
    .prepare(`INSERT INTO parents (name, email, phone, password_hash) VALUES (?, ?, ?, ?)`)
    .run("Jamie Rivera", "demo.parent@example.com", "+15185550142", hashPassword("demo1234"));

  const whiteBeltId = db.prepare("SELECT id FROM belt_curriculum WHERE order_index = 1").get().id;
  const lionPridePlan = db.prepare("SELECT id FROM plans WHERE program = 'Lion Pride'").get();

  const student = db
    .prepare(`
      INSERT INTO students (parent_id, name, program, current_rank_id, classes_attended_at_rank, plan_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(parent.lastInsertRowid, "Avery Rivera", "Lion Pride", whiteBeltId, 18, lionPridePlan ? lionPridePlan.id : null);

  const lionPrideClasses = db.prepare("SELECT id FROM classes WHERE program = 'Lion Pride'").all();
  const enroll = db.prepare("INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)");
  lionPrideClasses.forEach((c) => enroll.run(student.lastInsertRowid, c.id));

  db.prepare("UPDATE parents SET billing_status = 'active' WHERE id = ?").run(parent.lastInsertRowid);

  console.log("Seeded demo family: demo.parent@example.com / student Avery Rivera (18/20 classes toward Yellow Belt, billing active).");
}

function seedDemoLeads() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM leads").get().n;
  if (count > 0) return console.log("Demo leads already seeded, skipping.");

  const insert = db.prepare(`
    INSERT INTO leads (name, email, phone, program_interest, source, stage, notes)
    VALUES (@name, @email, @phone, @program_interest, @source, @stage, @notes)
  `);
  const rows = [
    { name: "Morgan Lee", email: "morgan.lee@example.com", phone: "+15185550111", program_interest: "Lion Pride", source: "Website form", stage: "New", notes: "Filled out the free class form last night." },
    { name: "Casey Brooks", email: "casey.brooks@example.com", phone: "+15185550122", program_interest: "Teens", source: "Referral", stage: "Trial Booked", notes: "Trial class booked for Thursday, referred by the Rivera family." },
  ];
  const insertMany = db.transaction((items) => items.forEach((r) => insert.run(r)));
  insertMany(rows);
  console.log(`Seeded ${rows.length} demo leads.`);
}

seedClasses();
seedBeltCurriculum();
seedPlans();
seedEvents();
seedDemoFamily();
seedDemoLeads();
console.log("Seed complete.");
