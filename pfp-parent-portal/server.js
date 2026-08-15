require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");

require("./db"); // ensures schema is created before anything else runs

const webhooksRouter = require("./routes/webhooks");
const signupRouter = require("./routes/signup");
const portalRouter = require("./routes/portal");
const adminRouter = require("./routes/admin");
const trialRouter = require("./routes/trial");
const pushRouter = require("./routes/push");
const { layout } = require("./views/layout");
const { ensureCatalogPlan } = require("./services/billing");

const app = express();

// Needed so express-session knows to trust the "X-Forwarded-Proto" header
// from Render/Railway's reverse proxy when deciding whether to mark the
// session cookie secure (cookie.secure: "auto" below).
app.set("trust proxy", 1);

// Mounted BEFORE the body parsers below: Square webhook signature
// verification needs the raw, unparsed request body.
app.use("/webhooks", webhooksRouter);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "pfp.sid",
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: "auto", // HTTPS only once behind Render's HTTPS proxy; plain http:// locally still works
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.get("/", (req, res) => {
  const body = `
    <span class="eyebrow">PFP Kickboxing Academy</span>
    <h1>Parent Portal &amp; Reminder System</h1>
    <p style="color:var(--muted);max-width:60ch;">Sign up your family, see your student's schedule and belt progress, and get automatic reminders before every class, belt test, and school event.</p>
    <a class="btn" href="/signup">Sign Up</a>
    <a class="btn secondary" href="/portal" style="margin-left:10px;">Parent Portal</a>
    <a class="btn secondary" href="/trial" style="margin-left:10px;">Try a Free Class</a>
  `;
  res.send(layout({ title: "Home", active: "/", body }));
});

app.use("/signup", signupRouter);
app.use("/portal", portalRouter);
app.use("/admin", adminRouter);
app.use("/trial", trialRouter);
app.use("/push", pushRouter);

// Health check for hosting platforms / uptime pings.
app.get("/healthz", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PFP Parent Portal running at http://localhost:${PORT}`);
  // Start the reminder cron job in the same process. See cron.js for the
  // schedule and README.md for the Vercel-serverless alternative.
  require("./cron");
  // If real Square credentials are set, make sure the shared $139/mo
  // subscription plan + variation exist before the first checkout needs
  // them. No-op in dry-run mode or once it's already been created.
  ensureCatalogPlan().catch((err) => console.error("[SQUARE] Couldn't set up the Catalog subscription plan:", err.message));
});
