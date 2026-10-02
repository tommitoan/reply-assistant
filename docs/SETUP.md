# Setup

Everything is run from the repository root. A Vietnamese version is in [HUONG-DAN.vi.md](HUONG-DAN.vi.md).

## Requirements

- Node.js 20 or newer, and npm
- Docker (for the local database), or any Postgres with the `vector` extension (pgvector)
- An Anthropic API key
- Optional: a Voyage AI key for memory and notes search

## Run locally

```bash
npm install
cp .env.example .env
```

Fill in `.env`: `DATABASE_URL`, `REPLY_DB_PASSWORD` (the same password as in the URL), `APP_PASSCODE` (16+ random characters), `APP_SESSION_SECRET` (32+), `REPLY_ANTHROPIC_API_KEY`. Random values: `openssl rand -base64 24` and `openssl rand -base64 48`.

Start the database and create the tables. Docker is the same on every OS, but installing it is not:

- **macOS only:** install Docker Desktop or OrbStack and start it first.
- **Ubuntu only:** `sudo apt-get install docker.io docker-compose-v2`, then `sudo usermod -aG docker $USER` and log in again.
- **Fedora only:** install Docker CE from Docker's dnf repository (`sudo dnf install docker-ce docker-compose-plugin`), then `sudo systemctl enable --now docker`.

Same on all three:

```bash
docker compose -f compose.dev.yml up -d --wait
DATABASE_URL=postgres://reply:<REPLY_DB_PASSWORD>@127.0.0.1:5433/reply npm run db:migrate
npm run dev
```

Pass `DATABASE_URL` inline for database commands and read the line `[drizzle] database target: …` before trusting the result: a shared `.env` can point at another database. `drizzle.config.ts` refuses to change a non-local database unless `ALLOW_REMOTE_MIGRATE=1` is set.

Open http://localhost:3000 and sign in with `APP_PASSCODE`.

**Try it without an API key:** with an empty local database, `npm run seed:demo` adds a chat, a few requests with replies, notes (one private, one waiting in the inbox), two style-profile versions and usage rows. The demo notes carry placeholder vectors.

## Self-host with Docker

The simplest way to run it on a server or a home machine: one command starts the database, creates the tables, and starts the app.

```bash
cp .env.example .env
```

Fill in `.env`: `REPLY_DB_PASSWORD` (any strong password), `APP_PASSCODE`, `APP_SESSION_SECRET`, `REPLY_ANTHROPIC_API_KEY`, and optionally `VOYAGE_API_KEY` and `APP_PORT`. You do not need to touch `DATABASE_URL`: in this mode it is built from the password and points at the `db` container.

```bash
docker compose up -d --build
docker compose ps          # app should become "healthy"
docker compose logs -f app
```

Open `http://localhost:3000` (or your `APP_PORT`) and sign in.

What happens:

| Service | Does |
|---|---|
| `db` | Postgres 17 with pgvector. Not published on any port; data in the `pgdata` volume |
| `migrate` | Runs once per `up` and exits: applies `drizzle/` to the database (already-applied migrations are skipped) |
| `app` | The Next.js standalone server on port 8080 inside the container, started only after `migrate` succeeded. The image has a healthcheck on `/api/health` |

To update: pull the new code and run `docker compose up -d --build` again; new migrations are applied first. To stop: `docker compose down` (data is kept; `down -v` deletes it).

On a server, put a reverse proxy with HTTPS in front (Caddy, Nginx, Traefik) and do not expose the port directly. The login cookie is only as safe as the connection it travels on. Make sure the proxy does not buffer responses, or the replies will appear all at once instead of progressively.

A database you already have (for example Neon) works too: build and run only the image, with your own `DATABASE_URL`:

```bash
docker build -t reply-assistant .
docker run -d --name reply-assistant -p 3000:8080 --env-file .env reply-assistant
```

(and apply the migrations once, as in the Railway steps below). A plain Postgres on a private network is addressed with `?sslmode=disable` at the end of the URL; any other host uses TLS.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | | Postgres with pgvector. Hosted databases need `?sslmode=require`; use the direct (not pooled) URL for migrations |
| `APP_PASSCODE` | yes | | Login passcode, 16+ random characters recommended (shorter works but logs a warning) |
| `APP_SESSION_SECRET` | yes | | Signs the login cookie, 32+ characters. Changing it signs everyone out |
| `REPLY_ANTHROPIC_API_KEY` | yes (or set `ANTHROPIC_API_KEY`) | | Use a dedicated key so you can set a separate spend limit |
| `VOYAGE_API_KEY` | no | | Without it memory is off and notes are saved without vectors |
| `REPLY_EMBED_MODEL` | no | `voyage-3.5-lite` | 1024-dimension embeddings |
| `REPLY_EMBED_RPM` / `REPLY_EMBED_TPM` | no | `3` / `10000` | Your embedding account's per-minute limits. The defaults are the free tier |
| `REPLY_MODEL_FAST` | no | `claude-haiku-4-5` | the quick path |
| `REPLY_MODEL_SMART` | no | `claude-sonnet-5-5` | long threads, "Better", replies with notes |
| `REPLY_MODEL_SUMMARY` / `_EXPLAIN` / `_NOTES` | no | `claude-haiku-4-5` | summaries, explanations, notes helpers |
| `REPLY_MODEL_STYLE` | no | `claude-sonnet-5-5` | building a style profile |
| `REPLY_SMART_EFFORT` | no | `low` | `low`, `medium` or `high` |
| `REPLY_SMART_THINKING` | no | `adaptive` | or `between_tools` |
| `REPLY_SELF_NAMES` | no | empty | the names you appear under in pasted chats, comma separated |
| `REPLY_DAILY_BUDGET_USD` | no | `2` | requests are refused when a UTC day's spend reaches this |

## Deploy: Railway + Neon

A fuller step-by-step version with a checklist and troubleshooting: [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md).

1. **Neon**: create a database (pgvector is available). Use one branch for local work and one for real use. Take the **direct** URL for migrations and add `?sslmode=require`.
2. **Migrate**, from your machine, before the first deploy and again whenever `drizzle/` gains a file:

   ```bash
   DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
   ```

   Four migrations exist: the foundation; usage ledger and explanation; developed replies; notes. The code writes their columns on every request, so migrate **before** deploying the code that needs them. They only add.
3. **Railway**: create a service from this repository (the `Dockerfile` and `railway.toml` are used; the health check is `/api/health`) and set the variables above. Any other platform that runs a Dockerfile works the same way. `DATABASE_URL` may be the pooled URL here.
4. **Anthropic Console**: create a key for this app and set a monthly spend limit. `REPLY_DAILY_BUDGET_USD` only counts what the app recorded, so the console limit is the last line of defence if the passcode leaks.
5. **Smoke test**: `/api/health` answers without login; every other page redirects to `/login`; write one reply and check that the options appear progressively (if they appear all at once, a proxy is buffering the stream); rate it; open the stats page; sign out.

Backfill scripts, only needed if requests or notes were saved while embeddings were unavailable:

```bash
npm run backfill:memory     # past requests
npm run backfill:notes      # notes
```

A hosted database also needs `ALLOW_REMOTE_BACKFILL=1`.

## The embedding provider's free tier

An account with no payment method is limited to 3 requests and 10,000 tokens a minute. The app stays inside that by itself: it batches texts into one request, keeps a reserved share for lookups someone is waiting for, and skips a lookup instead of being refused. When the minute's budget is spent, memory or notes are skipped for that request and indexed afterwards.

A payment method only lifts the limit. If you add one, raise `REPLY_EMBED_RPM` and `REPLY_EMBED_TPM` (for example `2000` and `1000000`). Prepaid credit at that provider is not a hard spending cap; a virtual card with a limit is the safer way. The limiter is per process, so development, scripts and production sharing one key share one account limit, and an occasional real 429 is possible (it is handled).

## Tests

```bash
npm test
npm run lint && npx tsc --noEmit && npm run build
```

### Real-database checks

`scripts/smoke/*.ts` run against a local, **empty** Postgres (they refuse any other host and clean up after themselves). Pass the URL inline:

```bash
DATABASE_URL=postgres://reply:<REPLY_DB_PASSWORD>@127.0.0.1:5433/reply npx tsx scripts/smoke/notes-smoke.ts
```

| Script | What it proves |
|---|---|
| `memory`, `thread`, `usage`, `style` | memory retrieval, thread merge and summary, the cost ledger, the style profile and export |
| `notes`, `notes-use` | the private CHECK constraint, pinned limits, scope and privacy filters in prompts, similarity with exact figures |
| `refine` | developing a reply: lineage, direction and the ledger |
| `suggest` | proposing notes: repeats, the waiting limit, approval, a pasted message never read |
| `privacy` | no copy of a private note's wording survives, the notes export, editing style rules |
| `embed-budget` | the rate limiter against the real embedding API |

`suggest` and `embed-budget` have a live stage that runs when `VOYAGE_API_KEY` (and for `suggest` the Anthropic key) is in `.env`; without keys they stop after the database stage.

## What each call sends

| Call | To Anthropic | To the embedding provider |
|---|---|---|
| Write a reply, Develop | your typed idea or the pasted chat and thread summary, the active style rules, notes that are **not private, active and of the right scope**, memory examples, today's date | your typed idea, or the last 600 characters of a paste |
| Explain, thread summary | the pasted messages, the older thread messages | |
| Build a style profile | replies you edited, liked or disliked, your typed ideas and Develop directions (cut to 400 characters each); never other people's pasted messages | |
| Notes: English version, diary split | only the note or diary you choose to send; never a private note | |
| Index a note | | the text and the English version of a note that is not private |
| Suggest notes | your typed idea or Develop direction (up to 1,500 characters); never a pasted message; nothing with Learn off | the proposed facts |
| Warm-up | the style rules and your pinned notes of the scope in use | |

**Never sent:** private notes, notes of the other scope, archived notes, and suggestions that are waiting or dismissed. One exception to know about: a reply that was already written may mention a detail from a note that was usable at the time; making the note private later cannot unwrite it.

Messages you paste go to Anthropic (and the embedding provider when memory is on) and are stored in Postgres. Do not paste customer data or company secrets.

## Security notes

- Everything except `/login` and `/api/health` is behind the passcode, because the endpoints cost money.
- Five wrong passcodes from one client lock it out for 15 minutes, and 20 from anyone lock everyone out for 15 minutes (the client address header can be forged, so the overall cap does not rely on it). The limiter is in memory: a restart clears it.
- The login cookie lasts 30 days. Change `APP_SESSION_SECRET` to sign out everywhere.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `db:migrate` exits at once without an error | A hosted URL without `?sslmode=require` |
| The first request after idle is slow | A serverless database wakes on the first query |
| "memory skipped" | The minute's embedding budget was spent; try again in a minute or raise the limits (see above) |
| A note says "not searchable yet" | It was saved while embeddings were unavailable. Open the About me page (it indexes in the background) or run `npm run backfill:notes` |
| My own lines in a pasted chat are marked "Them" | Set `REPLY_SELF_NAMES` to the name you appear under |
| "The daily spending limit for replies is reached" | `REPLY_DAILY_BUDGET_USD` was hit; it resets at 00:00 UTC |
| "Not enough rated or edited replies" when building a style profile | At least 5 edited or rated replies from requests made with Learn on |
| The inbox stays empty | Only typed ideas and Develop directions are read, with Learn on; short texts, a full inbox (20) or a spent budget are skipped |
