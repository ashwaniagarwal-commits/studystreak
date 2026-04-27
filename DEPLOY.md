# Deploying StudyStreak to Vercel

This is a step-by-step. The whole thing should take ~15 minutes.

## What you need

- A **GitHub** account (free)
- A **Vercel** account (free; sign up with GitHub)
- A **Neon** Postgres database (free tier; created via Vercel marketplace in step 3)
- Node 20+ installed locally

## Steps

### 0. (One-time) Delete the v0.1 leftover folders

The earlier local-only version left behind `server/`, `web/`, `scripts/`, and `data/` folders. They aren't used by Vercel and `.gitignore` skips them, but you can delete them to keep things clean. From the `studystreak` folder in PowerShell or File Explorer, delete: `server`, `web`, `scripts`, `data`. Don't delete `api`, `lib`, `public`, `test`.

### 1. Push the code to GitHub

From inside the `studystreak` folder:

```bash
git init
git add .
git commit -m "studystreak v0.2 — vercel-ready"
```

Then create a new (empty) repo on github.com → don't add a README/license, just create. Copy the repo URL it shows you, then back in your terminal:

```bash
git branch -M main
git remote add origin https://github.com/<your-user>/studystreak.git
git push -u origin main
```

### 2. Import the project into Vercel

Go to https://vercel.com/new → "Import Git Repository" → pick `studystreak`. Vercel auto-detects the project. Don't change any settings yet — just click **Deploy**.

The first deploy will **fail** because there's no `DATABASE_URL` yet. That's expected. Continue to step 3.

### 3. Provision Neon Postgres via Vercel

In your Vercel project dashboard → **Storage** tab → **Create Database** → pick **Neon (Postgres)** → free tier → connect. Vercel automatically:

- Creates a Neon database
- Sets `DATABASE_URL` (and a few related env vars) on the project
- Restarts the deployment

### 4. (Optional) Enable the demo reset endpoint

Project → **Settings** → **Environment Variables** → add `ALLOW_RESET=1` (Production + Preview). This lets the "Reset demo" button on the frontend wipe the DB. **Remove this for any real users.**

### 5. Re-deploy

Project → **Deployments** → most recent → ⋯ menu → **Redeploy**. This time it builds with `DATABASE_URL` set, runs the schema migration on the first request, seeds Arjun, and you're live.

You'll get a public URL like `studystreak-xxxx.vercel.app`. Open it on your phone — the daily loop should work end-to-end. The first hit takes 1–2 seconds (cold start + migrate + seed); subsequent hits are sub-200ms.

## Local development with `vercel dev`

Once the project is deployed, you can run it locally with the same env vars:

```bash
npm install
npx vercel link        # one-time: link this folder to the Vercel project
npx vercel env pull    # downloads DATABASE_URL into .env.local
npx vercel dev         # runs api/* via Vercel runtime, public/ as static
```

Open http://localhost:3000 and you're using the same Neon DB as prod. To use a separate DB for local, create a new Neon branch in their dashboard (free) and put its URL in `.env.local`.

## Running tests

The engine tests don't touch the DB, so they run anywhere:

```bash
npm test
```

26 tests should pass.

## Troubleshooting

**"DATABASE_URL is not set"** — env var didn't make it. In Vercel project settings, verify `DATABASE_URL` exists for Production. For local, run `npx vercel env pull` again.

**"relation 'users' does not exist"** — the first request after a fresh DB triggers `ensureSchema()`. Hit `/api/today` once and tables will be created.

**Frontend loads but API 500s** — check Vercel project → Deployments → most recent → Logs. The error trace will be there.

**Stale data in browser** — Vercel caches static assets. Hard-reload (Ctrl+Shift+R / Cmd+Shift+R).

**Cold-start latency feels slow** — first hit on a function that hasn't been called in 5+ minutes adds ~600ms. This is fine for v0; not fine for prod (sprint 11 hardening adds Edge functions and warming for hot paths).

## Costs at this scale

- Vercel hobby plan: **free** (100 GB-hours/mo of function execution; v0 will use <1)
- Neon free tier: **free** (0.5 GB storage, 100 hours of compute/mo)

If you hit free-tier limits during user testing (>200 active testers): Vercel Pro is $20/mo, Neon Launch is $19/mo. Total $39/mo well into hundreds of users.
