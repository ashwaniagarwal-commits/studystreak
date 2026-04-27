# Deploying StudyStreak to AWS

Production-grade architecture: **Fastify on App Runner + RDS Postgres**, all in `ap-south-1` (Mumbai).

This replaces the Vercel/Neon path. You can keep both deployed in parallel during transition (Vercel for quick share links, AWS as the real production), but pick one URL to give to testers.

## What you need

- An **AWS account** with permissions to create RDS, App Runner, IAM roles, and Secrets Manager entries. If you're using Vedantu's account, check with their AWS admin first — the steps below assume you have these privileges.
- The GitHub repo from before (already pushed)
- ~30 minutes the first time

## Costs (zero users)

| Component                 | Spec                         | Monthly ₹  |
|---------------------------|------------------------------|------------|
| App Runner                | 0.25 vCPU / 0.5 GB           | ~₹1,000    |
| RDS Postgres              | `db.t4g.micro`, 20 GB        | ~₹1,300    |
| Storage + traffic         | minimal                      | ~₹200      |
| **Total**                 |                              | **~₹2,500/mo** |

Higher than Neon's free tier; this is the price of production-grade.

---

## Steps

### 0. (One-time) Pre-requisites

Open the AWS Console (https://console.aws.amazon.com/) and switch the region to **Asia Pacific (Mumbai) `ap-south-1`** (top-right region selector).

### 1. Create the RDS Postgres instance

Console → **RDS** → **Databases** → **Create database**.

- **Choose a database creation method:** Standard create
- **Engine type:** PostgreSQL
- **Version:** 16 (latest)
- **Templates:** Free tier (or "Dev/Test" if free tier isn't available — pick the smallest)
- **DB instance identifier:** `studystreak-db`
- **Master username:** `postgres`
- **Master password:** generate a long random one and **paste it into a password manager now**. You'll need it in step 4.
- **Instance configuration:** `db.t4g.micro` (2 vCPU burstable, cheapest)
- **Storage:** 20 GiB, GP3
- **Connectivity:**
  - VPC: default
  - **Public access: Yes** (for v0 simplicity; sprint 11 hardening puts this in a private subnet)
  - VPC security group: **Create new** → name it `studystreak-db-sg`
  - Availability zone: any
  - Database port: 5432
- **Database authentication:** Password authentication
- **Additional configuration:** expand → **Initial database name:** `studystreak`

Click **Create database**. Wait 5–10 minutes for status to go from "Creating" to "Available".

### 2. Allow inbound from App Runner

While RDS is provisioning, find the **security group `studystreak-db-sg`** (Console → EC2 → Security Groups) → **Edit inbound rules** → Add rule:

- Type: PostgreSQL (5432)
- Source: **Anywhere-IPv4** (0.0.0.0/0)

Yes, this is open to the internet — fine for v0 because the password protects access. Sprint 11 replaces this with a VPC connector to App Runner.

### 3. Build the connection string

Once RDS shows **Available**, click into it and copy the **Endpoint** (looks like `studystreak-db.xxxx.ap-south-1.rds.amazonaws.com`). Build the URL:

```
postgresql://postgres:<URL-ENCODED-PASSWORD>@<endpoint>:5432/studystreak
```

If your password has special characters (`@`, `#`, `&`, `:`, `/`, `+`, etc.), URL-encode them. A `@` becomes `%40`, etc. Keep the result in your password manager.

### 4. Create the App Runner service

Console → **App Runner** → **Create service**.

- **Source:** Source code repository
  - **Connect to GitHub** — authorize AWS Connector for GitHub if first time
  - **Repository:** `studystreak`
  - **Branch:** `main`
  - **Source directory:** `/`
  - **Deployment trigger:** Automatic
- **Configure build:**
  - **Configuration file:** Use a configuration file (it'll read `apprunner.yaml`)
- **Configure service:**
  - **Service name:** `studystreak`
  - **Virtual CPU & memory:** 0.25 vCPU, 0.5 GB
  - **Environment variables:** add these
    - `DATABASE_URL` = paste the connection string from step 3
    - `NODE_ENV` = `production`
    - `LOG_LEVEL` = `info`
    - (Optional, dev-only) `ALLOW_RESET` = `1` if you want the "Reset demo" button to work
  - **Port:** 8080
  - **Health check:** HTTP `/healthz` (default settings)
  - **Auto scaling:** keep defaults (1 min, 25 max — it'll only spin up extras under real load)

Click **Create & deploy**. First build takes 4–6 minutes. App Runner: pulls your repo → runs `npm ci` per `apprunner.yaml` → starts `node server/server.js` → health-checks `/healthz`.

When status flips to **Running**, copy the **Default domain** URL — something like `xxxxxx.ap-south-1.awsapprunner.com`. Open it.

### 5. First-request bootstrap

The first request triggers `ensureSchema()` → table creation → seed for user `demo`. This adds ~2 seconds to the first hit. Subsequent requests are sub-200ms.

Open `https://<your-apprunner-url>/` on your phone. Confirm: Arjun's name, 🔥 5 streak, 3 lecture tiles. Tap one Done → streak grows to 6. You're live.

### 6. Custom domain (optional)

App Runner → Service → **Custom domains** → **Link domain** → enter your domain (e.g., `streak.studystreak.app`) → App Runner gives you 3 DNS records to add at your registrar. Once propagated, AWS issues a free TLS cert via ACM.

---

## After deploy

- **CI is automatic.** Every `git push` to `main` re-deploys. Watch progress in App Runner → **Deployments** tab.
- **Logs** live in App Runner → **Logs**. Application + System log tabs.
- **Metrics**: App Runner → Service → **Metrics** for request count, response time, CPU/mem.

## Disable the Vercel deployment

Once AWS is your production, kill Vercel so testers don't hit two URLs:

Vercel dashboard → studystreak project → **Settings** → **Pause Project** (or **Delete** if you're done with it). The Neon DB will stay; delete it from the Storage tab if you want to fully clean up.

---

## Troubleshooting

**App Runner build fails on `npm ci`** — ensure `package-lock.json` was committed. If you switched dependencies recently, delete `node_modules` and `package-lock.json` locally, run `npm install`, commit the new lockfile, push.

**Service status: Deploy failed → look at logs** — App Runner → Logs → System log. Common causes: missing env var, port mismatch (must be 8080), `DATABASE_URL` typo.

**"connection terminated due to connection timeout"** — RDS security group isn't allowing App Runner. Double-check inbound rule on `studystreak-db-sg` includes port 5432 from 0.0.0.0/0 (or App Runner's egress IP range if you've locked it down).

**"password authentication failed"** — URL-encode special chars in the password. `:` → `%3A`, `@` → `%40`, etc.

**Slow first request after idle** — App Runner scales to zero after 5 min idle (this is what makes it cheap). First request after takes ~2s. Sprint 11 adds a warming ping.

**Want to ship faster updates** — App Runner auto-deploys on push, but the build still takes ~4 min. Sprint 11 can move to ECS Fargate with blue-green deploys for 30-second rolls.

---

## Sprint 11 hardening (reference, not now)

When you're ready for real users (>500 concurrent):

- Move RDS into a private subnet, use App Runner's VPC connector
- Replace 0.0.0.0/0 inbound rule with explicit App Runner egress
- Move `DATABASE_URL` from env var to AWS Secrets Manager (rotated)
- Add CloudFront in front for static caching
- Put RDS Proxy between App Runner and RDS for connection pooling at scale
- Multi-AZ for RDS, min 2 instances on App Runner
- AWS WAF for basic rate limiting and bot mitigation
