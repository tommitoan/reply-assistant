# Architecture

How Reply Assistant is put together, and why. Numbers in this document (limits, thresholds) are named constants in `lib/reply/`; the file is given next to each.

## The request path

`POST /api/reply/generate` (`app/api/reply/generate/route.ts`) → `startGeneration` (`lib/reply/generate.ts`).

1. **Plan the notes** (database read only): which of your notes could apply, and is a search needed? No model, no embedding.
2. **One embedding request** serves both the memory lookup and the notes search (`embedMany`, fail-open).
3. **Choose**: memory examples (cosine distance ≤ 0.4, at most 5, `memory.ts`) and notes (below).
4. **Route** to a model (`router.ts`) and **build the prompt** (`prompt.ts`).
5. **Stream** the answer as NDJSON, parse options while they arrive (`stream-parser.ts`), save the result, send `done`.
6. **After the response** (`after()` in Next.js): index the request for memory, fold older thread messages into a summary, and propose notes from what you typed.

The stream is a sequence of one-line JSON events: `meta` (model, notes offered), `delta` (text), `explain` (the Vietnamese explanation, which arrives from a parallel call), `done` (saved options, usage, cost, notes used) or `error`. A cancelled client aborts the model call.

## Prompt layout and caching

| Part | Contents | Changes |
|---|---|---|
| **Cached prefix** (system) | the style guide, the active style profile, your pinned notes for the request's scope | only when you edit one of them |
| **Per-request message** | `<thread_summary>`, `<thread>`, `<about_me>`, `<today>`, `<memory_examples>`, `<task>`, `<input>` | every request, slowest-changing first |

The prefix must be byte-identical between requests, so no date, id or per-request value may be interpolated into it. A warm-up call (`/api/reply/warm`) sends the same prefix when you open the page, so the first real request already hits the cache. Pinned notes are per scope (work, casual), so each scope has its own cached prefix.

Everything the user wrote or pasted is **data**: it sits between tags, and one sanitizer removes marker lines and rewrites every tag name the prompt uses, so text cannot close a section. A test tries it for every tag.

## Model routing

`router.ts` is a pure function. Explicit choices win (⚡ Fast, 🎯 Smart, "Better"). On Auto:

- a typed idea goes to the fast model, unless its thread is large (6,000 characters);
- a pasted message goes to the fast model only when it is small (≤ 4 messages and under 1,500 characters);
- **any request that carries notes about you goes to the careful model.** The fast model invented experiences for the writer when a message asked about their life and no note answered; a rule in the prompt alone did not stop it.

## Memory

After a request finishes (and Learn is on), its input is embedded and stored. A new request retrieves the nearest past requests whose replies you liked, edited or used, and offers them as examples. An old reply can contain a fact that is no longer true, so the prompt tells the model to prefer a note over an old example.

## Notes

A note has a text, an English version (matching Vietnamese against English messages directly is weak, so each note carries a translation), a kind (`fact` or dated `event`), a scope (`work`, `casual`, `both`) and two flags: `pinned` and `private`.

**Using notes** (`notes-select.ts`, `notes-context.ts`, `notes-read.ts`), for a pasted message:

- up to 30 unpinned notes are sent **whole** and the model decides which to use;
- a larger collection is searched: the better of a note's two vectors, similarity floor 0.40, top 5, events fading by up to 15% over a year;
- pinned notes go in the cached prefix instead;
- the model ends its answer with `@@used 1,3` (or `none`). The parser hides that line while streaming, strips it from the saved text, and ignores a number that was never offered. The page shows "Used N notes" with *Don't use this one* (the same request again, with the note excluded in the query).

For a **typed idea**, nothing is inserted: the nearest notes appear as chips, and a click develops that reply with the note.

**Learning notes** (`suggest-*.ts`): after a response, a small model reads your own typed words (never a pasted message, never with Learn off) and proposes at most three explicit facts as strict JSON. Each proposal is checked against every existing note by normalised text (private notes included, compared only on the server) and by meaning (similarity ≥ 0.80), then saved as `suggested`. Nothing is used before you approve it in the inbox. A dismissed text is remembered so it is not proposed again.

## Privacy model

The rule is "a private note never reaches a model or a file". It is enforced three times:

1. **Database**: `CHECK (NOT private OR (text_en IS NULL AND embedding IS NULL AND embedding_en IS NULL AND NOT pinned))`.
2. **Service**: making a note private clears everything derived from it in the same statement; making it usable again is the one moment its text is sent out, after a warning.
3. **Reader**: `notes-read.ts` is the only place a prompt can get notes from. It selects `active`, not private, scope equal to the request's context or `both`, and not switched off for this request.

Copies are the subtle part. A reply developed with a note keeps a copy of the note's wording in its stored direction, and both the style-profile builder and the export read that column. When a note becomes private, or is deleted, `scrubDirections` replaces such a copy with the bare `[personal detail]` tag. This was found by asking where else a note's text could live, reproduced on a real database before the fix, and then covered by a check that fails if the fix is removed.

## Cost control

- Every model and embedding call writes a row to `reply_usage` (kind, model, tokens, cost). The usage page reads that table.
- `REPLY_DAILY_BUDGET_USD` (default $2, UTC day) refuses new requests when reached. Background work (summaries, suggestions, indexing) checks it before calling a model.
- Embeddings run behind a rolling-window limiter with two lanes (`embed-limiter.ts`): lookups someone is waiting for keep a reserved share, indexing waits. Texts of one action are batched into one request, and a refused call returns `null`, so every caller fails open. The defaults are the free tier of the embedding provider (3 requests and 10,000 tokens a minute).

## Data model

| Table | Holds |
|---|---|
| `conversations`, `messages` | threads and their pasted or chosen messages (de-duplicated by a normalised hash and a merge algorithm, `thread-merge.ts`) |
| `generations`, `reply_options` | one row per request and its options with rating, edit and chosen flags; vectors for memory; the direction of a developed reply; the notes used |
| `profile_notes` | notes and suggestions, with two vectors each |
| `style_profiles` | versioned rules, at most one active |
| `reply_usage` | the cost ledger |

Migrations are additive and live in `drizzle/`.

## Testing strategy

- **Unit and component tests** (Vitest) with fakes that record what they are sent, so a test can assert that a secret string never appears in anything sent to a model.
- **Real-Postgres scripts** (`scripts/smoke/`) for the promises a fake cannot prove: SQL filters, constraints, atomic limits, vector similarity with exact figures, and the whole request path over a real database with a fake model.
- **Break it on purpose.** Each guarantee that matters was checked by temporarily breaking the logic and watching a check fail. A mutation that did not fail twice exposed a premise error (a list cut before the check that was meant to see it).
- **Live checks** against the real model and embedding APIs, kept out of CI: the rate limiter against the real 429s, the duplicate threshold on real sentence pairs, and the model's behaviour on a prompt-injection attempt.

## Decisions worth knowing

- **Drafts only.** The app never sends anything, which keeps a wrong draft cheap.
- **The model proposes, you decide.** Learned notes, style rules and anything else the model writes about you start switched off.
- **Fail open.** Memory, notes, the explanation and the summary are extras; their failure never fails a reply.
- **One read query owns privacy.** Prompt code never filters notes itself.
- **Pure functions for the rules** (routing, note selection, parsing, merging), thin wiring around them.
