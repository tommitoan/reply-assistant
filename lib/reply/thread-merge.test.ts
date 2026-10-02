// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cleanPaste,
  hashText,
  mergePaste,
  normalizeForHash,
  parsePaste,
  type MessageAuthor,
  type StoredMessageRef,
} from "./thread-merge";

const SLACK = `Alice Nguyen  10:32 AM
Hey, are you free to review my PR?

Sam  10:35 AM
Sure, which one?

Alice Nguyen  10:36 AM
The one for the login page.`;

function stored(
  texts: string[],
  options: { author?: MessageAuthor; source?: StoredMessageRef["source"] } = {},
): StoredMessageRef[] {
  return texts.map((text) => ({
    author: options.author ?? "them",
    source: options.source ?? "pasted",
    text,
    normHash: hashText(text),
  }));
}

const texts = (blocks: { text: string }[]) => blocks.map((block) => block.text);

describe("parsePaste", () => {
  it("reads Slack desktop copies: speaker, time stripped, message text", () => {
    const blocks = parsePaste(SLACK, ["Sam"]);
    expect(blocks.map((b) => [b.author, b.text])).toEqual([
      ["them", "Hey, are you free to review my PR?"],
      ["me", "Sure, which one?"],
      ["them", "The one for the login page."],
    ]);
  });

  it("reads 'Name: text' lines when the names repeat, marking the writer from REPLY_SELF_NAMES", () => {
    const blocks = parsePaste("Linh: are we on for 3pm?\nSam: yes\nLinh: great, see you", ["sam"]);
    expect(blocks.map((b) => [b.author, b.text])).toEqual([
      ["them", "are we on for 3pm?"],
      ["me", "yes"],
      ["them", "great, see you"],
    ]);
  });

  it("matches the writer's names without caring about case or extra spaces", () => {
    const blocks = parsePaste("Linh: hi\nSam  Lee: hello\nLinh: ok", ["SAM LEE"]);
    expect(blocks[1].author).toBe("me");
  });

  it("does not mistake an ordinary 'Note: ...' line for a speaker", () => {
    const [block] = parsePaste("Note: the deploy is at 5pm", []);
    expect(block).toMatchObject({ author: "unknown", text: "Note: the deploy is at 5pm" });
  });

  it("treats 'You' and 'Me' labels as the writer even with no names configured", () => {
    const blocks = parsePaste("Linh: ready?\nYou: yes\nLinh: go", []);
    expect(blocks.map((b) => b.author)).toEqual(["them", "me", "them"]);
  });

  it("reads timestamp-prefixed exports", () => {
    const blocks = parsePaste("[10:32 AM] Linh: morning\n[10:33 AM] Sam: hi there", ["Sam"]);
    expect(blocks.map((b) => [b.author, b.text])).toEqual([
      ["them", "morning"],
      ["me", "hi there"],
    ]);
    const whatsapp = parsePaste("1/2/24, 10:32 - Linh: morning\n1/2/24, 10:33 - Sam: hi", ["Sam"]);
    expect(whatsapp.map((b) => b.author)).toEqual(["them", "me"]);
  });

  it("keeps a multi-line message together under its speaker", () => {
    const [block] = parsePaste("Linh  9:00 AM\nLine one\nLine two", []);
    expect(block).toMatchObject({ author: "them", text: "Line one\nLine two" });
  });

  it("splits unlabelled paragraphs on blank lines and marks them unknown", () => {
    const blocks = parsePaste("First message\n\nSecond message", []);
    expect(blocks.map((b) => [b.author, b.text])).toEqual([
      ["unknown", "First message"],
      ["unknown", "Second message"],
    ]);
  });

  it("falls back to one message per line when there are no blank lines or labels", () => {
    expect(texts(parsePaste("one\ntwo\nthree", []))).toEqual(["one", "two", "three"]);
  });

  it("returns nothing for an empty or whitespace-only paste", () => {
    expect(parsePaste("", [])).toEqual([]);
    expect(parsePaste("  \n\t \n  ", [])).toEqual([]);
  });

  it("ignores a header that has no message under it", () => {
    expect(texts(parsePaste("Alice  10:00 AM\n\nBob  10:01 AM\nhello", []))).toEqual(["hello"]);
  });
});

describe("cleanPaste and hashing", () => {
  it("unifies line endings, drops zero-width characters and trailing spaces, and squeezes blank runs", () => {
    expect(cleanPaste("a​ \r\nb\r\n\r\n\r\n\r\nc  ")).toBe("a\nb\n\nc");
  });

  it("hashes case and whitespace variants of a text identically, and different texts differently", () => {
    expect(hashText("Hello   World")).toBe(hashText("  hello world "));
    expect(hashText("hello world")).not.toBe(hashText("hello world!"));
    expect(normalizeForHash("A​  B")).toBe("a b");
  });
});

describe("mergePaste", () => {
  it("adds everything to an empty thread", () => {
    const result = mergePaste([], SLACK, ["Sam"]);
    expect(result.appended).toHaveLength(3);
    expect(result.skippedDuplicates).toBe(0);
  });

  it("adds nothing when the same paste is pasted again", () => {
    const first = mergePaste([], SLACK, ["Sam"]);
    const thread = first.appended.map((b) => ({ ...b, source: "pasted" as const }));
    const second = mergePaste(thread, SLACK, ["Sam"]);
    expect(second.appended).toEqual([]);
    expect(second.skippedDuplicates).toBe(3);
  });

  it("adds exactly the one new message when the whole thread is pasted again with one more", () => {
    const thread = stored([
      "Hey, are you free to review my PR?",
      "Sure, which one?",
      "The one for the login page.",
    ]);
    const result = mergePaste(thread, `${SLACK}\n\nSam  10:40 AM\nGot it, looking now.`, ["Sam"]);
    expect(texts(result.appended)).toEqual(["Got it, looking now."]);
    expect(result.appended[0].author).toBe("me");
  });

  it("adds a pasted message that has no overlap with the thread", () => {
    const thread = stored(["Hey, are you free to review my PR?", "Sure, which one?"]);
    const result = mergePaste(thread, "Alice  10:50 AM\nCan you also check the tests?", []);
    expect(texts(result.appended)).toEqual(["Can you also check the tests?"]);
  });

  it("finds the overlap when the paste starts partway through the thread", () => {
    const thread = stored(["one", "two", "three", "four"]);
    const result = mergePaste(thread, "three\n\nfour\n\nfive\n\nsix", []);
    expect(texts(result.appended)).toEqual(["five", "six"]);
  });

  it("ignores an earlier message that was edited and still adds what is new", () => {
    const thread = stored(["first message", "second message", "third message"]);
    const result = mergePaste(thread, "first message (edited)\n\nsecond message\n\nthird message\n\nfourth message", []);
    expect(texts(result.appended)).toEqual(["fourth message"]);
  });

  it("treats whitespace, case and timestamp differences as the same message", () => {
    const thread = stored(["Hello   there, are you free?"]);
    const result = mergePaste(thread, "Alice  11:11 PM\nhello there, ARE you free?\n\nAlice  11:12 PM\nPing", []);
    expect(texts(result.appended)).toEqual(["Ping"]);
  });

  it("copes with Windows line endings and zero-width characters in the paste", () => {
    const thread = stored(["see you at three"]);
    const result = mergePaste(thread, "see​ you at three\r\n\r\nand bring the laptop", []);
    expect(texts(result.appended)).toEqual(["and bring the laptop"]);
  });

  it("does nothing for an empty paste", () => {
    expect(mergePaste(stored(["a"]), "   \n ", [])).toEqual({ appended: [], skippedDuplicates: 0 });
  });

  it("starts at the first of several equal matches, so a repeated 'ok' does not hide new messages", () => {
    const thread = stored(["can you send it?", "ok"]);
    const result = mergePaste(thread, "ok\n\nsent it\n\nok\n\nthanks", []);
    expect(texts(result.appended)).toEqual(["sent it", "ok", "thanks"]);
  });

  describe("replies chosen in the app", () => {
    const chosen = stored(["I can review it this afternoon."], { author: "me", source: "chosen_reply" });
    const thread = [...stored(["Can you review my PR today?"]), ...chosen];

    it("are not added again when the next paste contains them", () => {
      const result = mergePaste(
        thread,
        "Alice  1:00 PM\nCan you review my PR today?\n\nSam  1:02 PM\nI can review it this afternoon.\n\nAlice  1:05 PM\nGreat, thanks!",
        ["Sam"],
      );
      expect(texts(result.appended)).toEqual(["Great, thanks!"]);
    });

    it("are recognised when sent with small edits, without re-adding the older messages", () => {
      const result = mergePaste(
        thread,
        "Can you review my PR today?\n\nSam: I can review it this afternoon. 🙂\n\nGreat, thanks!",
        ["Sam"],
      );
      expect(texts(result.appended)).toEqual(["Great, thanks!"]);
    });

    it("are skipped even when the paste carries only that reply", () => {
      const result = mergePaste(thread, "I can review it this afternoon.", []);
      expect(result.appended).toEqual([]);
      expect(result.skippedDuplicates).toBe(1);
    });

    it("are not matched when too short to tell a copy from a different message", () => {
      const shortThread = [...stored(["Did it work?"]), ...stored(["Yes!"], { author: "me", source: "chosen_reply" })];
      const result = mergePaste(shortThread, "Yes! And one more thing: the build is green", []);
      expect(result.appended).toHaveLength(1);
      expect(result.appended[0].text).toContain("the build is green");
    });
  });
});
