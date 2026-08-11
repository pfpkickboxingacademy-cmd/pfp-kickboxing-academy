-- PFP Parent Portal schema

CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  sms_opt_in INTEGER NOT NULL DEFAULT 1,
  email_opt_in INTEGER NOT NULL DEFAULT 1,
  billing_status TEXT NOT NULL DEFAULT 'no_plan', -- no_plan | active | past_due | canceled
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  program TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0=Sun .. 6=Sat
  start_time TEXT NOT NULL,     -- 'HH:MM' 24h
  end_time TEXT NOT NULL,
  age_range TEXT
);

CREATE TABLE IF NOT EXISTS belt_curriculum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  classes_required INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id),
  name TEXT NOT NULL,
  dob TEXT,
  program TEXT NOT NULL,
  current_rank_id INTEGER REFERENCES belt_curriculum(id),
  classes_attended_at_rank INTEGER NOT NULL DEFAULT 0,
  eligible_for_test INTEGER NOT NULL DEFAULT 0,
  test_date TEXT,
  test_eligibility_notified_at TEXT,
  plan_id INTEGER REFERENCES plans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program TEXT NOT NULL,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL,
  stripe_price_id TEXT -- set once you create the matching Price in Stripe
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  UNIQUE(student_id, class_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  event_time TEXT,          -- 'HH:MM'
  location TEXT
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_type TEXT NOT NULL, -- 'class' | 'belt_test' | 'event' | 'billing' | 'lead_nurture'
  reference_key TEXT NOT NULL, -- e.g. class_id:YYYY-MM-DD, event_id, student_id
  channel TEXT NOT NULL,       -- 'email' | 'sms' | 'push'
  recipient TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  dry_run INTEGER NOT NULL DEFAULT 0,
  UNIQUE(reminder_type, reference_key, channel, recipient)
);

-- CRM: prospective families, tracked through a pipeline before they enroll.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  program_interest TEXT,
  source TEXT,                              -- e.g. 'Website form', 'Referral', 'Walk-in'
  stage TEXT NOT NULL DEFAULT 'New',        -- New | Trial Booked | Trial Attended | Enrolled | Lost
  notes TEXT,
  converted_parent_id INTEGER REFERENCES parents(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_stage_change_at TEXT NOT NULL DEFAULT (datetime('now')),
  welcome_sent_at TEXT,
  nudge_sent_at TEXT
);

-- Mobile app (PWA): browser push subscriptions, one per device a parent installs on.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Forgot-password flow: single-use, expiring tokens emailed to the parent.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
