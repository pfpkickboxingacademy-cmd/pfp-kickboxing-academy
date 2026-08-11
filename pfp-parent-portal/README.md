# PFP Parent Portal

A self-hosted, Spark-style system for PFP Kickboxing Academy: parents sign up and pay dues once, then automatically get reminders before class, when their student hits a belt-test milestone, and ahead of school events. Prospective families are tracked through a lead pipeline before they enroll, and the whole thing installs on a phone like an app.

Built as a small standalone app (separate from the marketing site) since it needs a real database and background jobs, which a static HTML site can't do.

## What it does

- **Sign-up + billing** (`/signup`) — parent + student info, a password, program selection, then Stripe Checkout for monthly dues. Signing up logs you straight in.
- **Real login** (`/portal`) — email + password, backed by hashed passwords and server-side sessions (30-day cookie), plus a "Forgot your password?" email reset flow. No more trusting a client-supplied email.
- **Parent portal** (`/portal/dashboard`, login required) — schedule, belt progress bar, billing status, a "Manage Billing" button, and an "Enable Push Notifications" button to install the app.
- **Lead capture** (`/trial`) — public "try a free class" form that feeds the CRM pipeline.
- **Admin dashboard** (`/admin`, password protected):
  - **Dashboard** — roster with billing status, one-click "+1 class" attendance logging, set belt test dates, create events, manual reminder trigger.
  - **Leads (CRM)** — kanban-style pipeline (New → Trial Booked → Trial Attended → Enrolled → Lost), add/move leads by hand.
  - **Billing Plans** — edit monthly price and Stripe Price ID per program.
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
- `http://localhost:3000/signup` — sign up a test family with a password (billing runs in dry-run: marks active without charging)
- `http://localhost:3000/trial` — submit a test lead
- `http://localhost:3000/portal` — log in with `demo.parent@example.com` / `demo1234` (seeded demo student, 18/20 classes toward Yellow Belt)
- `http://localhost:3000/admin` — any username, password `changeme`. Try the Leads board, edit a Billing Plan, and click "Run Reminders Now" — watch the terminal for `[DRY RUN EMAIL]` / `[DRY RUN SMS]` / `[DRY RUN PUSH]` / `[DRY RUN STRIPE]` output. Everything is fully testable with zero real accounts connected.

## Turning dry-run into the real thing

Copy `.env.example` to `.env` and fill in what you need:

| Area | Variables | Notes |
|---|---|---|
| Admin | `ADMIN_PASSWORD` | Change before deploying anywhere public |
| Sessions | `SESSION_SECRET` | Signs parent login cookies — generate a real random string (see `.env.example`) before deploying |
| Email | `RESEND_API_KEY`, `RESEND_FROM` | [Resend](https://resend.com), free tier covers this scale |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | [Twilio](https://twilio.com), ~$0.0079/text + ~$1-2/mo number |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` | [Stripe](https://stripe.com) — test-mode keys are free/instant |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Generate with `npx web-push generate-vapid-keys` |
| Timing | `CLASS_REMINDER_MINUTES`, `EVENT_REMINDER_DAYS`, `LEAD_NUDGE_DAYS`, `REMINDER_CRON_SCHEDULE` | All optional, sensible defaults |

Restart the app after editing `.env`.

### Setting up real billing (Stripe)

1. Create a free Stripe account, stay in **test mode** to try it risk-free.
2. In the Dashboard, create a **Product** per program (e.g. "Lion Pride Monthly") with a recurring monthly **Price**. Copy the Price ID (`price_...`).
3. Paste that Price ID into Admin → Billing Plans for the matching program.
4. Add `STRIPE_SECRET_KEY` (Dashboard → Developers → API keys) to `.env`.
5. Add a webhook endpoint in the Dashboard pointing at `https://yourdomain.com/webhooks/stripe`, listening for at least: `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
6. In the Dashboard, go to **Settings → Billing → Customer portal** and turn it on (choose whether to allow customers to cancel, update card, etc.) — this powers the "Manage Billing" button on the parent dashboard, which lets families update an expired card or view past charges themselves.
7. Switch to live mode keys when ready to charge real cards.

### How the recurring monthly charge actually works

This is already fully automatic once Stripe is connected — there's nothing to trigger manually:

1. At sign-up, the parent enters their card once through Stripe Checkout. Stripe saves it to their Customer record.
2. Stripe charges that card itself every month on the Price's billing cycle — this app doesn't run any billing logic, it just listens.
3. `invoice.payment_succeeded` / `invoice.payment_failed` webhooks keep `billing_status` in sync here automatically.
4. A failed card gets Stripe's own automatic retry attempts (Smart Retries) over the following days before it's considered failed for good.
5. The moment a payment fails, the family flips to "Past Due" in admin and gets an automatic reminder (email/SMS/push) via the existing reminder engine.
6. Parents can update an expiring/declined card themselves anytime via "Manage Billing" on their dashboard — no need to re-do the sign-up flow.

### Setting up real push notifications

1. `npx web-push generate-vapid-keys`, paste the two keys into `.env`.
2. Restart the app. Parents click "Enable Push Notifications" on their dashboard after installing the app (Share → Add to Home Screen on iPhone, or the browser's install prompt on Android/desktop Chrome).

## Deploying so it runs unattended

Needs to be an **always-on process** (not just serverless functions), since the reminder cron runs continuously in the background.

- **Render** or **Railway** — simplest choice at this scale: connect the GitHub repo, set the env vars in their dashboard, done.
- **Fly.io** — similar, slightly more setup.
- **Vercel** — the marketing site's current host, but Vercel functions don't stay running, so `cron.js` won't work there as-is. If staying on Vercel is a hard requirement: swap `cron.js` for [Vercel Cron](https://vercel.com/docs/cron-jobs) hitting a new `/api/run-reminders` route on a schedule, and move the SQLite database to hosted Postgres (Vercel Postgres or Supabase), since serverless functions don't have persistent local disk.

## Before this goes live for real families

- **Real belt curriculum.** Seeded ranks (White → Black, 20-40 classes each) are placeholders.
- **Real billing plans.** Seeded monthly prices ($129-149) are placeholders — set real prices and Stripe Price IDs in Admin → Billing Plans before connecting live Stripe keys.
- **Attendance logging.** "+1 Class" in admin is manual. If there's a check-in kiosk process already, wire that in instead.
- **PCI/compliance.** Card data never touches this app — Stripe Checkout handles it entirely — but review Stripe's own compliance requirements before going live.
- **App store listing.** This ships as an installable PWA (no app store, no fees). A real App Store/Google Play listing is a separate, bigger build (native/React Native) requiring Apple ($99/yr) and Google Play ($25) developer accounts.
- **Adding a second student to an existing account.** Right now `/signup` is only for a brand-new family — an email that already has a password is rejected with "log in instead." There's no in-portal "add another student" form yet; for now that'd need to be done directly (e.g. via a small admin tool) until that flow is built.

## Why build this instead of just using Spark

Spark Membership (~$99-199/mo) bundles all of this — reminders, portal, billing, CRM, and a branded app — maintained for you. This system covers the same functional ground, self-hosted, at roughly the cost of the Stripe/email/SMS bills themselves (a few dollars a month at under 100 families) instead of a subscription, fully customized to PFP's real brand and schedule. The tradeoff: no vendor support, and someone has to own hosting and maintaining it.

## Project structure

```
server.js              Express app entry point
cron.js                Schedules the reminder sweep
db/schema.sql          Table definitions (parents, students, classes, plans, leads, push subscriptions...)
db/seed.js              Loads real PFP class schedule, belt ranks, billing plans, demo data
services/notify.js      Email (Resend) + SMS (Twilio) senders, dry-run fallback
services/billing.js     Stripe Checkout + billing portal + webhook verification, dry-run fallback
services/push.js        Web Push sender, dry-run fallback
services/auth.js         Password hashing, session login middleware, password reset emails
services/reminders.js   Core reminder + lead-nurture logic
routes/signup.js        Sign-up form (incl. password) + Stripe checkout handoff
routes/portal.js        Login, logout, forgot/reset password, parent dashboard
routes/admin.js         Staff dashboard: roster, billing plans, leads, events, manual reminder trigger
routes/trial.js         Public lead capture ("free class") form
routes/webhooks.js      Stripe webhook endpoint
routes/push.js          Push subscription endpoints
views/layout.js          Shared HTML shell (PFP brand colors/fonts, PWA meta tags)
public/styles.css        Design tokens matching the marketing site
public/manifest.json     PWA manifest
public/sw.js             Service worker (installability + push display)
public/app.js            Client-side: SW registration, push subscribe button
public/icons/            App icons generated from the real PFP logo
```
