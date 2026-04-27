# StudyStreak — v0.3 (AWS App Runner + RDS)

A working v0 of StudyStreak, deployable to AWS in `ap-south-1` (Mumbai). Production-grade architecture per §3 of the implementation plan: a long-running Fastify container on App Runner with RDS Postgres for state.

See **[AWS_DEPLOY.md](./AWS_DEPLOY.md)** for the step-by-step deploy.

```
studystreak/
├── server/
│   └── server.js          Fastify app. All API routes + static frontend.
├── lib/
│   ├── streak-engine.js   Pure: streak rules, TZ-aware, freeze-aware
│   ├── priority-engine.js Pure: A/B/C banding ported from the Excel
│   ├── reward-engine.js   Pure: mystery-box probability + XP sampling
│   ├── db.js              Postgres adapter (pg with connection pool)
│   └── seed.js            Idempotent demo seed
├── public/                Static frontend served by Fastify
├── test/                  26 engine unit tests (no DB)
├── Dockerfile             Optional — for ECS Fargate or local Docker
├── apprunner.yaml         App Runner native Node build config
├── package.json
├── README.md
└── AWS_DEPLOY.md          Deploy steps
```

## Architectural notes

- **Engines pure.** The same `lib/streak-engine.js`, `priority-engine.js`, `reward-engine.js` from v0.1 and v0.2. Zero changes through three deploy targets (SQLite local → Neon Vercel → RDS AWS). 26 tests still green.
- **One Postgres pool per process.** Fastify's long-running model means we open the pool once, reuse it across requests. App Runner gets a small managed VM, not Lambda's cold starts.
- **Schema migrates on first request.** `ensureSchema()` is idempotent; safe to run on every boot. No CLI step.
- **Health endpoint at `/healthz`.** App Runner pings this to know the service is alive.

## Local development

```bash
npm install

# Option A: run against a local Postgres (e.g., docker-compose pg)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/studystreak \
DATABASE_SSL=disable \
ALLOW_RESET=1 \
npm start

# Option B: run against the same RDS that's deployed (be careful)
DATABASE_URL='<paste-prod-url>' ALLOW_RESET=1 npm start
```

Then open http://localhost:8080.

## Run tests

```bash
npm test
```

26 tests should pass. They don't touch the DB, so they run anywhere.

## What's intentionally not here yet

(Sprints 5–10 of the implementation plan)

- Auth (single hardcoded `demo` user)
- Mobile app
- Push notifications
- Squad / duels / Sunday review
- PM dashboard UI (the data is exposed via `/api/dashboard`)
- Voice reflections (text-only for v0)

## Decisions worth flagging

- **Score formula in `priority-engine.js`** differs from PRD §8.3. The original cap was 200, making A-band unreachable. Rebalanced to `100 + 80×status + 60×days/10 + 30×subjectGap + 30×relatedRecency` (max 300). Update PRD next revision.
- **Mystery-box first-3-sessions block** is enforced server-side. Demo seed gives Arjun 14 sessions so the block doesn't bite during testing.
- **All thresholds hardcoded for now**. Sprint 7 moves them to a feature-flag service for live tuning.
- **`ALLOW_RESET=1` exposes a destructive endpoint.** Set it during testing, remove it before any real users.
