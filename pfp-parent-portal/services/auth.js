// Real parent authentication: bcrypt-hashed passwords + server-side
// sessions (see server.js for the express-session setup). Replaces the
// original "type in any email to see that family's data" prototype.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const { sendEmail } = require("./notify");

const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MINUTES = 30;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(password, hash);
}

// Express middleware: only lets the request through if a parent is logged
// in (req.session.parentId). Everything under /portal except the
// login/signup/forgot-password pages should use this.
function requireParentLogin(req, res, next) {
  if (!req.session || !req.session.parentId) {
    return res.redirect("/portal?next=" + encodeURIComponent(req.originalUrl));
  }
  const parent = db.prepare("SELECT * FROM parents WHERE id = ?").get(req.session.parentId);
  if (!parent) {
    req.session.destroy(() => {});
    return res.redirect("/portal");
  }
  req.parent = parent;
  next();
}

async function sendPasswordResetEmail(parent) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60000).toISOString();
  db.prepare(`INSERT INTO password_resets (parent_id, token, expires_at) VALUES (?, ?, ?)`).run(
    parent.id,
    token,
    expiresAt
  );
  const resetUrl = `${APP_URL}/portal/reset?token=${token}`;
  await sendEmail({
    to: parent.email,
    subject: "Reset your PFP Parent Portal password",
    text: `Hi ${parent.name}, click the link below to set a new password. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
  });
}

function consumeResetToken(token) {
  const row = db.prepare(`SELECT * FROM password_resets WHERE token = ?`).get(token);
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

module.exports = {
  hashPassword,
  verifyPassword,
  requireParentLogin,
  sendPasswordResetEmail,
  consumeResetToken,
};
