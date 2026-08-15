const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");
const db = new Database(DB_PATH);
// Note: WAL mode is skipped on purpose — it needs shared-memory file locking
// that some mounted/networked filesystems (e.g. sandboxed dev environments)
// don't support. The default rollback-journal mode works everywhere and is
// plenty fast at this scale (< a few hundred families).
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Lightweight migrations for anyone upgrading a database created before
// billing/CRM/push were added. CREATE TABLE IF NOT EXISTS above already
// handles brand-new tables (plans, leads, push_subscriptions); this just
// adds the new columns to tables that already existed. Safe to re-run.
function addColumnIfMissing(table, column, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}
addColumnIfMissing("parents", "billing_status", "TEXT NOT NULL DEFAULT 'no_plan'");
addColumnIfMissing("parents", "square_customer_id", "TEXT");
addColumnIfMissing("parents", "square_subscription_id", "TEXT");
addColumnIfMissing("parents", "password_hash", "TEXT");
addColumnIfMissing("students", "plan_id", "INTEGER REFERENCES plans(id)");
addColumnIfMissing("students", "is_founding_member", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("plans", "square_plan_variation_id", "TEXT");
// Old databases (pre-Square) still have these Stripe columns lying around —
// harmless to leave in place, just no longer written to.

module.exports = db;
