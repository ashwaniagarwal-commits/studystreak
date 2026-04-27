# StudyStreak — v0.2 (Vercel-deployable)

A working v0 of the StudyStreak app: a consistency-first study planner for JEE droppers. Built per the v1 PRD and Implementation Plan in the parent folder.

This drop is the **daily core loop, end-to-end**, deployable to Vercel + Neon Postgres in 15 minutes. See **[DEPLOY.md](./DEPLOY.md)** for the step-by-step.

```
studystreak/
├── api/                            Vercel serverless functions
│   ├── today.js                    GET  /api/today
│   ├── lectures/
│   │   ├── index.js                GET  /api/lectures?from=&to=
│   │   └── [id]/status.js          PATCH /api/lectures/:id/status
│   ├── streak.js                   GET  /api/streak
│   ├── backlog.js                  GET  /api/backlog
│   ├── reflections.js              GET + POST /api/reflections
│   ├── dashboard.js                GET  /api/dashboard
│   └── __reset.js                  POST /api/__reset (dev-only, gated by ALLOW_RESET=1)
├── lib/                            Pure logic + DB + helpers
│   ├── streak-engine.js            Streak rules, TZ-aware, freeze-aware
│   ├── priority-engine.js          A/B/C banding ported from the Excel
│   ├── reward-engine.js            Mystery-box probability + XP sampling
│   ├── db.js                       Postgres adapter (Neon, HTTP transport)
│   ├── seed.js                     Idempotent demo seed
│   └── api.js                      Shared route helpers
├── public/                         Static frontend (served by Vercel)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── test/                           26 engine unit tests (no DB)
├── package.json
├── vercel.json
└── DEPLOY.md
```

## Architectural notes

**Engines are pure.** `lib/streak-engine.js`, `lib/priority-engine.js`, `lib/reward-engine.js` have zero I/O. They run identically on Node, Vercel functions, and (when we get there) React Native. The 26 tests in `test/` exercise them in isolation, including a 20,000-trial statistical test of the mystery-box drop rate.

**Each route is a separate function.** Vercel cold-starts ~600 ms once per 5-min idle window. We accept this for v0; sprint 11 of the impl plan introduces Edge functions and warming for hot paths.

**Schema migrations run on first request.** `ensureSchema()` in `lib/db.js` is idempotent and cached per warm function instance. No CLI migration step.

**Demo seed is idempotent.** First request to any API route triggers `init()` → `ensureSchema()` → `seedIfEmpty('demo')`. After the first hit, subsequent hits skip the seed.

## Run locally

```bash
npm install
npx vercel link              # one-time, links this folder to your Vercel project
npx vercel env pull          # pulls DATABASE_URL into .env.local
npx vercel dev               # serves api/* + public/ on http://localhost:3000
```

## Run tests

The engine tests don't touch the DB:

```bash
npm test
```

26 tests should pass.

## What's intentionally not here yet

(Sprints 5–10 of the implementation plan)

- Auth (single hardcoded `demo` user)
- Mobile app (browser-only for v0; the React Native version reuses `lib/` verbatim)
- Push notifications
- Squad / duels / Sunday review
- PM dashboard UI (the data is exposed via `/api/dashboard`; the HTML mockup in the parent folder shows the target)
- Voice reflections (text-only for v0)

## Decisions worth flagging

- The score formula in `priority-engine.js` differs from PRD §8.3 — original weights cap at 200, making A-band unreachable. Rebalanced to `100 + 80×status + 60×days/10 + 30×subjectGap + 30×relatedRecency` (max 300). Update PRD in next revision.
- Mystery-box first-3-sessions block is enforced server-side. Demo user has 14 sessions seeded so the block doesn't bite.
- All thresholds (mystery-box `p`, band cutoffs, freeze count) are intentionally constants right now — sprint 7 moves them to GrowthBook for live tuning.
