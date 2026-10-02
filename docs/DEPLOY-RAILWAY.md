# Deploy on Railway (with Neon)

A step-by-step guide to putting Reply Assistant online: the app runs on [Railway](https://railway.com) from this repository's `Dockerfile`, and the data lives in [Neon](https://neon.tech) Postgres. Vietnamese version: [DEPLOY-RAILWAY.vi.md](DEPLOY-RAILWAY.vi.md).

Dashboard labels change now and then; the ideas stay the same. Anything that runs a Dockerfile can host the app the same way, and [SETUP.md](SETUP.md#self-host-with-docker) covers a plain `docker compose` server.

```
browser ──HTTPS──▶ Railway (this Dockerfile, Next.js standalone) ──TLS──▶ Neon Postgres + pgvector
                         │
                         └──▶ Anthropic API (and Voyage AI, optional)
```

## What you need

- A GitHub copy of this repository (your own fork or the original).
- A Neon account, a Railway account, an Anthropic API key. A Voyage AI key is optional (memory and notes search).
- Node.js 20+ on your machine, only to run the migrations once.

Generate the secrets you will paste later (any machine with OpenSSL):

```bash
openssl rand -base64 24     # APP_PASSCODE
openssl rand -base64 48     # APP_SESSION_SECRET
```

## 1. Create the database (Neon)

1. Create a project. Pick a region close to where you will run Railway (both offer Singapore, for example).
2. Open **Connect** and copy two connection strings:
   - the **direct** one (host without `-pooler`): used for migrations;
   - the **pooled** one (host with `-pooler`): optional for the app. The app turns prepared statements off on its own when it sees `-pooler`.
3. Add `?sslmode=require` to the end of each. Do **not** use `channel_binding=require`: the Postgres driver the app uses does not support it.

The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`, so there is nothing to enable by hand.

## 2. Create the tables (once, from your machine)

The app writes columns from every migration on every request, so run the migrations **before** the first deploy, and again before deploying any change that adds a file to `drizzle/`.

```bash
git clone <your repository> reply-assistant && cd reply-assistant
npm install
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
```

Read the first output line: `[drizzle] database target: <host>/<database>`. It must be the Neon database you mean; migrations change it. `ALLOW_REMOTE_MIGRATE=1` is the guard that says "yes, this remote database".

To check, open Neon's SQL editor and run `select tablename from pg_tables where schemaname = 'public'`: you should see `conversations`, `generations`, `messages`, `profile_notes`, `reply_options`, `reply_usage` and `style_profiles`.

## 3. Create the service (Railway)

1. **New Project → Deploy from GitHub repo**, authorize the Railway GitHub app for the repository, and select it.
2. Railway reads `railway.toml` and builds the `Dockerfile`: the build stage compiles the app, the runtime stage (the last stage) runs the standalone server. The health check is `/api/health`.
3. The first build starts at once. It will not become healthy until the variables below exist, so open the service's **Variables** tab (use the **Raw Editor**) and paste:

   ```
   DATABASE_URL=<neon pooled or direct url>?sslmode=require
   APP_PASSCODE=<value from openssl>
   APP_SESSION_SECRET=<value from openssl>
   REPLY_ANTHROPIC_API_KEY=<your Anthropic key>
   # optional
   VOYAGE_API_KEY=<your Voyage key>
   REPLY_SELF_NAMES=<the name(s) you appear under in chats, comma separated>
   REPLY_DAILY_BUDGET_USD=2
   ```

   Every other variable has a default; the full list is in [SETUP.md](SETUP.md#environment-variables). Do not set `PORT` (Railway provides it) and do not set `REPLY_DB_PASSWORD` or `APP_PORT` (those are for Docker Compose).
4. Redeploy after saving the variables (Railway usually does it for you).
5. **Settings → Networking → Generate Domain** to get a public `https://….up.railway.app` address. A custom domain can be added in the same place.
6. In **Settings**, choose a **region** near your database.

## 4. Check that it works

- `https://<your domain>/api/health` answers `{"status":"ok"}` without logging in.
- Every other page, including the home page `/`, redirects to `/login`; the API answers 401 without a session.
- Sign in with `APP_PASSCODE`. Write one reply: the options should appear **progressively**. If they all appear at once, something in front of the app is buffering the stream.
- Rate a reply, open **Stats** and **Usage** (the cost of your call should be there), then **Sign out**.

If `/api/health` is fine but pages fail, the usual cause is `DATABASE_URL`: the health check does not touch the database, so a wrong URL shows up only on use. Look at the service logs.

## 5. Make it safe to leave running

1. **Anthropic Console**: use a key made for this app and set a **monthly spend limit** on it. `REPLY_DAILY_BUDGET_USD` only counts what the app recorded, so the console limit is the last line of defence if the passcode leaks.
2. **Passcode**: 16+ random characters. A shorter one works but logs a warning. After five wrong guesses a client is locked out for 15 minutes, and twenty from anyone lock everyone out for 15 minutes.
3. **Railway**: set a usage limit in your account's billing settings, so an unexpected bill cannot grow unnoticed.
4. Rotating `APP_SESSION_SECRET` signs everyone out.

## Updating

Railway redeploys when you push to the branch it watches. When a change adds a file to `drizzle/`, run the migration command from step 2 **first**, then push. Deployments can be rolled back from the **Deployments** tab; migrations only add, so an older version keeps working against a newer database.

## Costs

Railway bills by usage; an app that is idle most of the time costs little. Neon's free plan suspends an idle database, so the first request after a quiet period is slow. The model calls are the real cost: about a quarter of a cent for a quick reply on the fast model and about a cent on the careful one, all visible on the **Usage** page.

## Voyage AI (optional)

Without `VOYAGE_API_KEY`, memory is off and notes are saved without vectors, which is fine to start. Add the key later and run the backfill once from your machine, so older requests and notes become searchable:

```bash
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_BACKFILL=1 VOYAGE_API_KEY=<key> npm run backfill:memory
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_BACKFILL=1 VOYAGE_API_KEY=<key> npm run backfill:notes
```

An account without a payment method is limited to 3 requests a minute; the app stays inside that by itself (see [SETUP.md](SETUP.md#the-embedding-providers-free-tier)).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails | Read the build log. The build downloads fonts from Google Fonts, so a network problem can break it |
| Deploy "unhealthy" or restarts in a loop | The service is not listening: check the deploy log. A missing required variable (`APP_PASSCODE`, `APP_SESSION_SECRET`, `REPLY_ANTHROPIC_API_KEY`, `DATABASE_URL`) makes routes fail while `/api/health` still answers |
| The sign-in page says the app is not configured, or every page returns to `/login` | `APP_PASSCODE` or `APP_SESSION_SECRET` is missing, or the secret is shorter than 32 characters |
| "locked out" after a few tries | Wait 15 minutes, or redeploy (the limiter lives in memory) |
| 500 on pages that read data | `DATABASE_URL` is wrong, lacks `?sslmode=require`, or the migrations were not run |
| First request after a quiet period is slow | The Neon database was suspended |
| Replies appear all at once | A proxy is buffering; compare with the default `*.up.railway.app` domain before blaming the app |
| "The daily spending limit for replies is reached" | `REPLY_DAILY_BUDGET_USD` was hit; it resets at 00:00 UTC |

This guide was written from the repository's own configuration (`railway.toml`, `Dockerfile`) and from running the same image locally with Docker Compose. The real Railway edge, in particular stream buffering, is the one thing worth confirming yourself with the check in step 4.
