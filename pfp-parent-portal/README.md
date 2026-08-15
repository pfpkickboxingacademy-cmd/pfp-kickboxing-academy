# PFP Parent Portal

A self-hosted, Spark-style system for PFP Kickboxing Academy: parents sign up and pay dues once, then automatically get reminders before class, when their student hits a belt-test milestone, and ahead of school events. Prospective families are tracked through a lead pipeline before they enroll, and the whole thing installs on a phone like an app.

Built as a small standalone app (separate from the marketing site) since it needs a real database and background jobs, which a static HTML site can't do.

## What it does

- **Sign-up + billing** (`/signup`) — parent + student info, a password, program selection ($139/mo flat, every program), then Square Checkout for monthly dues. The first 10 students to sign up (across all programs) get a Founding Member badge — price is the same $139/mo either way. Signing up logs you straight in.
- **Real login** (`/portal`) — email + password, backed by hashed passwords and server-side sessions (30-day cookie), plus a "Forgot your password?" email reset flow. No more trusting a client-supplied email.
- **Parent portal** (`/portal/dashboard`, login required) — a belt progress bar for each student right at the top of the page, with a "Check In Today" button parents can tap themselves to log attendance (once per student per day) and watch the bar move; 9 classes attended = eligible for belt testing. Below that: billing status, an "Update Card on File" button, schedule, and an "Enable Push Notifications" button to install the app.
- **Lead capture** (`/trial`) — public "try a free class" form that feeds the CRM pipeline.
- **Admin dashboard** (`/admin`, password protected):
  - **Dashboard** — roster with billing status, Founding Member badges, one-click "+1 class" attendance logging, set belt test dates, create events, manual reminder trigger.
  - **Leads (CRM)** — kanban-style pipeline (New → Trial Booked → Trial Attended → Enrolled → Lost), add/move leads by hand.
  - **Billing Plans** — edit monthly price and Square Plan Variation ID per program.
  - **Announcements** — send a one-off update (email + SMS) to every signed-up parent, separate from the automated reminders below.
- **Reminder engine** (`services/reminders.js`) — runs every 5 minutes and sends, on every channel a parent has enabled (email, SMS, and push if they installed the app):
  - **Class reminders** — 60 min (configurable) before each class.
  - **Belt test reminders** — one-time "eligible for testing" notice, then 3-days-out and day-of reminders once a test date is set.
  - **Event reminders** — 3 days out and day-of, to every registered parent.
  - **Billing reminders** — daily nudge to any parent whose dues payment failed.
  - **Lead nurture** — welcome message when a lead comes in, one "still interested?" nudge if they sit untouched for 3 days.
  - Every send is logged so nothing double-sends.
- **Installable app (PWA)** — `manifest.json` + service worker + brand icons (pulled from the real PFP logo) make "Add to Home Screen" work on iPhone and Android, with push notifications once installed. No app store, no developer account, no review process.

## Try it now (2 minutes, no accounts needed)

```bash
npm install
npm run seed     # loads PFP's real weekly schedule, belt ranks, billing plans + demo family/leads
npm start
```

Then open:
- `http://localhost:3000/signup` — sign up a test family with a password (billing runs in dry-run: marks active without charging; $139/mo, every program)
- `http://localhost:3000/trial` — submit a test lead
- `http://localhost:3000/portal` — log in with `demo.parent@example.com` / `demo1234` (seeded demo student, Founding Member, 6/9 classes toward Yellow Belt — tap "Check In Today" on the dashboard and watch the progress bar move)
- `http://localhost:3000/admin` — any username, password `changeme`. Try the Leads board, edit a Billing Plan, send a test Announcement, and click "Run Reminders Now" — watch the terminal for `[DRY RUN EMAIL]` / `[DRY RUN SMS]` / `[DRY RUN PUSH]` / `[DRY RUN SQUARE]` output. Everything is fully testable with zero real accounts connected.

## Turning dry-run into the real thing

Copy `.env.example` to `.env` and fill in what you need:

| Area | Variables | Notes |
|---|---|---|
| Admin | `ADMIN_PASSWORD` | Change before deploying anywhere public |
| Sessions | `SESSION_SECRET` | Signs parent login cookies — generate a real random string (see `.env.example`) before deploying |
| Email | `RESEND_API_KEY`, `RESEND_FROM` | [Resend](https://resend.com), free tier covers this scale |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | [Twilio](https://twilio.com), ~$0.0079/text + ~$1-2/mo number |
| Billing | `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `APP_URL` | [Square](https://squareup.com) — sandbox credentials are free/instant |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Generate with `npx web-push generate-vapid-keys` |
| Timing | `CLASS_REMINDER_MINUTES`, `EVENT_REMINDER_DAYS`, `LEAD_NUDGE_DAYS`, `REMINDER_CRON_SCHEDULE` | All optional, sensible defaults |

Restart the app after editing `.env`.

### Setting up real billing (Square)

1. Create a free Square Developer account at [developer.squareup.com](https://developer.squareup.com/apps) and open (or create) an application — it comes with a **Sandbox** environment you can test against risk-free with fake cards.
2. From the app's **Sandbox** tab, copy the **Sandbox Access Token** into `SQUARE_ACCESS_TOKEN`, and copy a **Location ID** (Locations tab) into `SQUARE_LOCATION_ID`. Leave `SQUARE_ENVIRONMENT=sandbox`.
3. Restart the server. On startup it automatically creates a single shared Catalog "Subscription Plan" + "Plan Variation" for the flat $139/mo membership (see `services/billing.js` → `ensureCatalogPlan`) and saves the variation ID onto every row in Admin → Billing Plans — there's nothing to create by hand in the Square Dashboard.
4. Add a webhook subscription in the Developer Dashboard (your app → **Webhooks**) pointing at `https://yourdomain.com/webhooks/square`, subscribed to at least: `subscription.created`, `subscription.updated`, `invoice.payment_made`, `invoice.updated`. Copy the **Signature Key** into `SQUARE_WEBHOOK_SIGNATURE_KEY`.
5. Test a full sign-up with one of [Square's sandbox test cards](https://developer.squareup.com/docs/testing/test-values) — you'll land on a real Square-hosted checkout page.
6. Switch `SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID` to your **Production** app credentials and `SQUARE_ENVIRONMENT=production` when ready to charge real cards (the shared plan/variation get re-created automatically in the new environment the first time the server starts).

### How the recurring monthly charge actually works

This is already fully automatic once Square is connected — there's nothing to trigger manually:

1. At sign-up, the parent is sent to a Square-hosted checkout page (a "payment link" tied to the shared $139/mo subscription plan). They enter their card once; Square creates a Customer record and saves the card to it.
2. Square charges that card itself every month on the plan's billing cycle — this app doesn't run any billing logic, it just listens for webhooks.
3. `subscription.updated` / `invoice.payment_made` / `invoice.updated` webhooks keep `billing_status` in sync here automatically (matched to the right family by email, since Square doesn't know about `parents.id`).
4. The moment a payment fails, the family flips to "Past Due" in admin and gets an automatic reminder (email/SMS/push) via the existing reminder engine.
5. Square doesn't ship a self-serve "customer portal" the way Stripe does. The "Update Card on File" button on the parent dashboard generates a fresh Square checkout link for the same plan — completing it swaps in the new card for future charges. It's a workaround, not a full account-management page; if that ever becomes a priority, Square's Web Payments SDK can build a proper in-app "update card" form instead of round-tripping through checkout.

### Setting up real push notifications

1. `npx web-push generate-vapid-keys`, paste the two keys into `.env`.
2. Restart the app. Parents click "Enable Push Notifications" on their dashboard after installing the app (Share → Add to Home Screen on iPhone, or the browser's install prompt on Android/desktop Chrome).

## Deploying so it runs unattended

Needs to be an **always-on process** (not just serverless functions), since the reminder cron runs continuously in the background.

- **Render** or **Railway** — simplest choice at this scale: connect the GitHub repo, set the env vars in their dashboard, done.
- **Fly.io** — similar, slightly more setup.
- **Vercel** — the marketing site's current host, but Vercel functions don't stay running, so `cron.js` won't work there as-is. If staying on Vercel is a hard requirement: swap `cron.js` for [Vercel Cron](https://vercel.com/docs/cron-jobs) hitting a new `/api/run-reminders` route on a schedule, and move the SQLite database to hosted Postgres (Vercel Postgres or Supabase), since serverless functions don't have persistent local disk.

## Before this goes live for real families

- **Real belt curriculum.** Seeded ranks (White → Black, 9 classes each) — confirm this matches PFP's actual testing requirements per rank.
- **Real billing plans.** $139/mo flat across all four programs is seeded and live — change in Admin → Billing Plans if pricing changes.
- **Attendance logging.** Parents can self-check-in from the dashboard (once per student per day); admin also has a manual "+1 Class" button in the roster for staff-logged attendance. If there's a check-in kiosk process already, that could replace/supplement either.
- **PCI/compliance.** Card data never touches this app — Square Checkout handles it entirely — but review Square's own compliance requirements before going live.
- **App store listing.** This ships as an installable PWA (no app store, no fees). A real App Store/Google Play listing is a separate, bigger build (native/React Native) requiring Apple ($99/yr) and Google Play ($25) developer accounts.
- **Adding a second student to an existing account.** Right now `/signup` is only for a brand-new family — an email that already has a password is rejected with "log in instead." There's no in-portal "add another student" form yet; for now that'd need to be done directly (e.g. via a small admin tool) until that flow is built.

## Why build this instead of just using Spark

Spark Membership (~$99-199/mo) bundles all of this — reminders, portal, billing, CRM, and a branded app — maintained for you. This system covers the same functional ground, self-hosted, at roughly the cost of the Square/email/SMS bills themselves (a few dollars a month at under 100 families, plus Square's standard card-processing rate) instead of a subscription, fully customized to PFP's real brand and schedule. The tradeoff: no vendor support, and someone has to own hosting and maintaining it.

## Project structure

```
server.js              Express app entry point
cron.js                Schedules the reminder sweep
db/schema.sql          Table definitions (parents, students, classes, plans, leads, push subscriptions, attendance_log...)
db/seed.js              Loads real PFP class schedule, belt ranks (9 classes each), $139/mo billing plans, demo data
services/notify.js      Email (Resend) + SMS (Twilio) senders, dry-run fallback
services/billing.js     Square Catalog + Checkout (subscriptions) + webhook verification, dry-run fallback
services/push.js        Web Push sender, dry-run fallback
services/auth.js         Password hashing, session login middleware, password reset emails
services/reminders.js   Core reminder + lead-nurture logic
routes/signup.js        Sign-up form (incl. password, founding-member flagging) + Square checkout handoff
routes/portal.js        Login, logout, forgot/reset password, parent dashboard (progress bar + self check-in)
routes/admin.js         Staff dashboard: roster, billing plans, leads, events, announcements, manual reminder trigger
routes/trial.js         Public lead capture ("free class") form
routes/webhooks.js      Square webhook endpoint
routes/push.js          Push subscription endpoints
views/layout.js          Shared HTML shell (PFP brand colors/fonts, PWA meta tags)
public/styles.css        Design tokens matching the marketing site
public/manifest.json     PWA manifest
public/sw.js             Service worker (installability + push display)
public/app.js            Client-side: SW registration, push subscribe button
public/icons/            App icons generated from the real PFP logo
```
