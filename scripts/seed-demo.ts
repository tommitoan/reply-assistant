/**
 * Fills an EMPTY local database with made-up data, so every page can be tried
 * (and screenshotted) without any API key: a work chat and two quick
 * translations with their replies (rated, edited, developed), a few notes (one
 * pinned, one private, one waiting in the inbox), two style-profile versions and
 * some usage rows.
 *
 * Nothing here calls a model or an embedding service. The notes carry
 * placeholder vectors only so that they show as indexed; with a real
 * VOYAGE_API_KEY, replace them by running `npm run backfill:notes` after
 * clearing the vectors, or simply add your own notes.
 *
 * LOCAL DATABASE ONLY, and only an EMPTY one:
 *   DATABASE_URL=postgres://reply:<PASSWORD>@127.0.0.1:5433/reply npm run seed:demo
 */
import { createRequire } from "node:module";
import { getDb } from "../lib/reply/db";
import {
  conversations,
  generations,
  messages,
  profileNotes,
  replyOptions,
  replyUsage,
  styleProfiles,
} from "../lib/reply/schema";

const repoRequire = createRequire(`${process.cwd()}/package.json`);
const { sql } = repoRequire("drizzle-orm") as typeof import("drizzle-orm");
const { loadEnvConfig } = repoRequire("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd(), true);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { hostname, port, pathname } = new URL(url);
console.log(`[seed-demo] database target: ${hostname}${port ? `:${port}` : ""}${pathname}`);
if (!LOCAL_HOSTS.has(hostname)) {
  console.error("[seed-demo] refusing: the demo data is only for a local database.");
  process.exit(1);
}

const USAGE = { input_tokens: 1400, output_tokens: 320, cache_creation_input_tokens: 0, cache_read_input_tokens: 1100 };
const day = (daysAgo: number, hour = 10) => new Date(Date.now() - daysAgo * 86_400_000 - (10 - hour) * 3_600_000);
const placeholderVector = (seed: number) =>
  Array.from({ length: 1024 }, (_, i) => Math.sin(seed * 13.37 + i * 0.37) / 32);

async function main() {
  const db = getDb();
  const [{ n }] = (await db.execute(
    sql`select (select count(*) from generations) + (select count(*) from profile_notes) as n`,
  )) as unknown as Array<{ n: number }>;
  if (Number(n) !== 0) {
    console.error("[seed-demo] the database already has data; use an empty local database.");
    process.exit(1);
  }

  // ---------------------------------------------------------------- notes
  const firstOfLastMonth = new Date();
  firstOfLastMonth.setUTCMonth(firstOfLastMonth.getUTCMonth() - 1, 1);
  const MODEL = "voyage-3.5-lite";
  const noteRows = await db
    .insert(profileNotes)
    .values([
      {
        text: "Mình làm backend engineer, chủ yếu dùng Go và Postgres.",
        textEn: "I'm a backend engineer. I mostly work with Go and Postgres.",
        kind: "fact",
        scope: "work",
        pinned: true,
        source: "manual",
        embedding: placeholderVector(1),
        embeddingEn: placeholderVector(2),
        embedModel: MODEL,
        createdAt: day(9),
      },
      {
        text: "Tháng trước mình mới dọn sang căn hộ mới.",
        textEn: "I moved to a new flat last month.",
        kind: "event",
        happenedOn: firstOfLastMonth.toISOString().slice(0, 10),
        scope: "both",
        source: "manual",
        embedding: placeholderVector(3),
        embeddingEn: placeholderVector(4),
        embedModel: MODEL,
        createdAt: day(8),
      },
      {
        text: "Cuối tuần mình hay đi leo núi với bạn.",
        textEn: "I often go hiking with friends at the weekend.",
        kind: "fact",
        scope: "casual",
        source: "imported",
        embedding: placeholderVector(5),
        embeddingEn: placeholderVector(6),
        embedModel: MODEL,
        createdAt: day(7),
      },
      {
        text: "Ghi chú riêng tư: chỉ nằm trong app, không bao giờ gửi cho model nào.",
        kind: "fact",
        scope: "both",
        private: true,
        source: "manual",
        createdAt: day(6),
      },
      {
        text: "Mình đang học tiếng Nhật.",
        textEn: "I'm learning Japanese.",
        kind: "fact",
        scope: "casual",
        status: "suggested",
        source: "suggested",
        embedding: placeholderVector(7),
        embeddingEn: placeholderVector(8),
        embedModel: MODEL,
        createdAt: day(1),
      },
    ])
    .returning({ id: profileNotes.id, text: profileNotes.text });
  const flatNote = noteRows[1].id;

  // -------------------------------------------------- a work chat, a reply
  const [chat] = await db
    .insert(conversations)
    .values({ title: "Release checklist with Maya", context: "work", createdAt: day(3), updatedAt: day(3) })
    .returning({ id: conversations.id });
  const lines: Array<["them" | "me", string]> = [
    ["them", "Hey Sam, did you get a chance to look at the release checklist?"],
    ["me", "Not yet. I'll go through it after lunch."],
    ["them", "Great, thanks. Also, did you finally move into the new flat?"],
  ];
  await db.insert(messages).values(
    lines.map(([author, text], i) => ({
      conversationId: chat.id,
      seq: i + 1,
      author,
      text,
      normHash: `demo-${i}`,
      source: "pasted" as const,
      createdAt: day(3, 9 + i),
    })),
  );
  const [reply1] = await db
    .insert(generations)
    .values({
      conversationId: chat.id,
      mode: "en_reply",
      context: "work",
      inputText: "(pasted conversation)",
      model: "claude-sonnet-5-5",
      speed: "auto",
      learn: true,
      useMemory: false,
      status: "done",
      usage: USAGE,
      costUsd: "0.009120",
      firstTokenMs: 1850,
      totalMs: 4210,
      noteIds: [flatNote],
      explanation:
        "Maya asks two things: whether you have looked at the release checklist yet (you said you would after lunch), and whether you have moved into your new flat. The tone is friendly and relaxed.",
      createdAt: day(3, 11),
    })
    .returning({ id: generations.id });
  await db.insert(replyOptions).values([
    { generationId: reply1.id, variant: "short", position: 0, text: "Not yet, but I'll finish the checklist today. And yes, I moved last month!" },
    {
      generationId: reply1.id,
      variant: "medium",
      position: 1,
      text: "Sorry, not yet. I'll go through the checklist after lunch and send you my comments. And yes, I moved to the new flat last month!",
      rating: "good",
      ratedAt: day(3, 12),
      chosen: true,
    },
    { generationId: reply1.id, variant: "long", position: 2, text: "Sorry, I haven't had time yet. I'll go through the checklist after lunch and send you my comments before 3pm. And yes, I moved to the new flat last month — thanks for asking!" },
    { generationId: reply1.id, variant: "alt", position: 3, text: "Not yet — after lunch, I promise. And yes, I'm in the new flat since last month." },
  ]);

  // ------------------------------------------- quick translations, rated
  const [casual] = await db
    .insert(generations)
    .values({
      mode: "vi_to_en",
      context: "casual",
      inputText: "Cảm ơn bạn nhiều nhé, cuối tuần này mình rảnh, đi uống cà phê nhé?",
      model: "claude-haiku-4-5",
      speed: "auto",
      learn: true,
      useMemory: false,
      status: "done",
      usage: USAGE,
      costUsd: "0.002490",
      firstTokenMs: 640,
      totalMs: 1520,
      createdAt: day(4, 18),
    })
    .returning({ id: generations.id });
  const casualOptions = await db
    .insert(replyOptions)
    .values([
      { generationId: casual.id, variant: "short", position: 0, text: "Thanks a lot! I'm free this weekend — coffee?", rating: "good", ratedAt: day(4, 18) },
      { generationId: casual.id, variant: "medium", position: 1, text: "Thanks so much! I'm free this weekend. Do you want to grab a coffee?", editedText: "Thanks so much! I'm free this weekend, want to grab a coffee?", chosen: true },
      { generationId: casual.id, variant: "long", position: 2, text: "Thank you so much, that really helped. I'm free this weekend — would you like to meet for a coffee?" },
      { generationId: casual.id, variant: "alt", position: 3, text: "That's very kind of you. Are you free for coffee this weekend?", rating: "bad", ratedAt: day(4, 18) },
    ])
    .returning({ id: replyOptions.id, variant: replyOptions.variant });

  const [work] = await db
    .insert(generations)
    .values({
      mode: "vi_to_en",
      context: "work",
      inputText: "Mình sẽ gửi báo cáo trước thứ Sáu, nhưng cần thêm một ngày để kiểm tra số liệu.",
      model: "claude-haiku-4-5",
      speed: "auto",
      learn: true,
      useMemory: false,
      status: "done",
      usage: USAGE,
      costUsd: "0.002310",
      firstTokenMs: 590,
      totalMs: 1380,
      createdAt: day(2, 15),
    })
    .returning({ id: generations.id });
  const workOptions = await db
    .insert(replyOptions)
    .values([
      { generationId: work.id, variant: "short", position: 0, text: "I'll send the report by Friday, but I need one more day to check the numbers." },
      { generationId: work.id, variant: "medium", position: 1, text: "I'll send you the report before Friday. I just need one more day to check the numbers.", rating: "good", ratedAt: day(2, 15), chosen: true },
      { generationId: work.id, variant: "long", position: 2, text: "I'll send the report before Friday, but I need one more day to double-check the numbers first. I'll tell you as soon as it's ready." },
      { generationId: work.id, variant: "alt", position: 3, text: "The report will be ready by Friday. Can I have one more day to check the figures?" },
    ])
    .returning({ id: replyOptions.id, variant: replyOptions.variant });

  // The writer developed the medium reply with a saved note.
  const base = workOptions.find((o) => o.variant === "medium")!;
  const [developed] = await db
    .insert(generations)
    .values({
      mode: "vi_to_en",
      context: "work",
      inputText: "Mình sẽ gửi báo cáo trước thứ Sáu, nhưng cần thêm một ngày để kiểm tra số liệu.",
      model: "claude-haiku-4-5",
      speed: "auto",
      learn: true,
      useMemory: false,
      status: "done",
      usage: USAGE,
      costUsd: "0.002050",
      firstTokenMs: 580,
      totalMs: 1710,
      refineOfOptionId: base.id,
      refineInstruction: "[personal detail] I moved to a new flat last month.",
      noteIds: [flatNote],
      createdAt: day(2, 16),
    })
    .returning({ id: generations.id });
  await db.insert(replyOptions).values([
    {
      generationId: developed.id,
      variant: "long",
      position: 0,
      text: "I'll send you the report before Friday. I just need one more day to check the numbers. Things have been a bit busy since I moved to the new flat last month, but it's under control.",
    },
    { generationId: developed.id, variant: "alt", position: 1, text: "You'll have the report before Friday — I only need one more day for the numbers. (I'm still settling into the new flat, so thanks for your patience!)" },
  ]);
  void casualOptions;

  // --------------------------------------------------------- style profile
  await db.insert(styleProfiles).values([
    {
      rules: "- Use short sentences.\n- Say \"ok\" instead of \"okay\".",
      sourceCounts: { edited: 4, liked: 3, disliked: 1, refined: 0 },
      model: "claude-sonnet-5-5",
      active: false,
      createdAt: day(5),
    },
    {
      rules: [
        "- Use contractions (I'm, can't, that's).",
        "- Start with the answer, then the reason.",
        "- Prefer \"ask\" over \"inquire\" and \"help\" over \"assist\".",
        "- End a work message with one clear next step.",
        "- Keep casual messages to two short sentences.",
      ].join("\n"),
      sourceCounts: { edited: 9, liked: 7, disliked: 3, refined: 2 },
      model: "claude-sonnet-5-5",
      active: true,
      createdAt: day(1),
    },
  ]);

  // ------------------------------------------------------------------ usage
  const usageRows: Array<{ kind: string; model: string; at: Date; cost: string; input: number; output: number }> = [];
  for (let d = 0; d < 9; d++) {
    usageRows.push({ kind: "generate", model: "claude-haiku-4-5", at: day(d, 11), cost: "0.002400", input: 1400, output: 320 });
    if (d % 2 === 0) usageRows.push({ kind: "generate", model: "claude-sonnet-5-5", at: day(d, 15), cost: "0.009100", input: 2300, output: 480 });
    if (d % 3 === 0) usageRows.push({ kind: "refine", model: "claude-haiku-4-5", at: day(d, 16), cost: "0.002000", input: 1300, output: 400 });
    if (d % 3 === 1) usageRows.push({ kind: "explain", model: "claude-haiku-4-5", at: day(d, 12), cost: "0.001200", input: 800, output: 300 });
    if (d % 4 === 0) usageRows.push({ kind: "embedding", model: "voyage-3.5-lite", at: day(d, 11), cost: "0.000001", input: 60, output: 0 });
    if (d % 4 === 2) usageRows.push({ kind: "notes", model: "claude-haiku-4-5", at: day(d, 17), cost: "0.000900", input: 500, output: 150 });
  }
  usageRows.push({ kind: "style_profile", model: "claude-sonnet-5-5", at: day(1, 20), cost: "0.014000", input: 5200, output: 420 });
  await db.insert(replyUsage).values(
    usageRows.map((row) => ({
      kind: row.kind,
      model: row.model,
      createdAt: row.at,
      costUsd: row.cost,
      inputTokens: row.input,
      outputTokens: row.output,
    })),
  );

  console.log("[seed-demo] done: 1 chat, 4 requests, 5 notes (1 private, 1 waiting in the inbox), 2 style versions, usage rows.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
