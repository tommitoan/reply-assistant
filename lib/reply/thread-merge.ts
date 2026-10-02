import { createHash } from "node:crypto";
import type { MessageAuthor, MessageSource } from "./types";

export type { MessageAuthor };

export interface MergeBlock {
  author: MessageAuthor;
  text: string;
  normHash: string;
}

// What the merge needs to know about messages already in the thread.
export interface StoredMessageRef {
  author: MessageAuthor;
  source: MessageSource;
  text: string;
  normHash: string;
}

export interface MergeResult {
  appended: MergeBlock[];
  skippedDuplicates: number;
}

// A chosen reply shorter than this is too generic ("ok", "thanks") to tell a
// copy of it from a different message that merely contains the same words.
const MIN_OWN_REPLY_CHARS = 12;

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

// Labels that mean "the writer" in chat exports and clients.
const SELF_LABELS = new Set(["me", "you"]);

export function normalizeForHash(text: string): string {
  return text.replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashText(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}

export function cleanPaste(raw: string): string {
  return raw
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface RawBlock {
  speaker: string | null;
  lines: string[];
}

// "Alice Nguyen  10:32 AM" (Slack desktop copy): a name, then a time, alone on a line.
const SLACK_HEADER = /^([^\n:]{1,60}?)(?:\s{2,}|\t)\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?$/;
// "[10:32 AM] Alice: hi" / "[1/2/24, 10:32] Alice: hi" / "1/2/24, 10:32 - Alice: hi" (exports).
const STAMPED_LINE =
  /^(?:\[[^\]]{3,40}\]|\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\s*-)\s*([^:\n]{1,60}):\s?(.*)$/;
// "Alice: hi"
const LABELLED_LINE = /^([^:\n]{1,40}):\s+(\S.*)$/;

function looksLikeName(candidate: string): boolean {
  const name = candidate.trim();
  if (name.length === 0 || name.length > 40) return false;
  if (name.split(/\s+/).length > 4) return false;
  // Names do not end a sentence and are not URLs or times.
  return !/[.?!,;]$/.test(name) && !/^https?$/i.test(name) && !/\d{1,2}:\d{2}/.test(name);
}

function canonicalName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

// Splits a cleaned paste into blocks, each with an optional speaker label.
function segment(clean: string, selfNames: Set<string>): RawBlock[] {
  const lines = clean.split("\n");

  // Pass 1: which "Name:" labels are real speakers? A label counts when it
  // appears more than once in the paste, or is one of the writer's own names.
  const labelCounts = new Map<string, number>();
  for (const line of lines) {
    const match = LABELLED_LINE.exec(line);
    if (match && looksLikeName(match[1])) {
      const key = canonicalName(match[1]);
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
  }
  const isRealLabel = (name: string): boolean => {
    const key = canonicalName(name);
    return selfNames.has(key) || SELF_LABELS.has(key) || (labelCounts.get(key) ?? 0) >= 2;
  };

  const blocks: RawBlock[] = [];
  let current: RawBlock | null = null;
  const flush = () => {
    if (current && current.lines.some((line) => line.trim() !== "")) blocks.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush(); // a blank line ends the message
      continue;
    }

    const slack = SLACK_HEADER.exec(line);
    if (slack && looksLikeName(slack[1])) {
      flush();
      current = { speaker: slack[1].trim(), lines: [] };
      continue;
    }

    const stamped = STAMPED_LINE.exec(line);
    if (stamped && looksLikeName(stamped[1])) {
      flush();
      current = { speaker: stamped[1].trim(), lines: [stamped[2]] };
      continue;
    }

    const labelled = LABELLED_LINE.exec(line);
    if (labelled && looksLikeName(labelled[1]) && isRealLabel(labelled[1])) {
      flush();
      current = { speaker: labelled[1].trim(), lines: [labelled[2]] };
      continue;
    }

    if (!current) current = { speaker: null, lines: [] };
    current.lines.push(line);
  }
  flush();

  // A header line with no message under it is not a message.
  const nonEmpty = blocks.filter((block) => block.lines.join("").trim() !== "");

  // No blank lines and no speaker labels: treat every line as its own message.
  if (nonEmpty.length === 1 && nonEmpty[0].speaker === null && nonEmpty[0].lines.length > 1) {
    return nonEmpty[0].lines.map((line) => ({ speaker: null, lines: [line] }));
  }
  return nonEmpty;
}

function authorOf(speaker: string | null, selfNames: Set<string>): MessageAuthor {
  if (speaker === null) return "unknown";
  const key = canonicalName(speaker);
  return selfNames.has(key) || SELF_LABELS.has(key) ? "me" : "them";
}

export function parsePaste(raw: string, selfNames: readonly string[] = []): MergeBlock[] {
  const names = new Set(selfNames.map(canonicalName).filter(Boolean));
  return segment(cleanPaste(raw), names).map((block) => {
    const text = block.lines.join("\n").trim();
    return { author: authorOf(block.speaker, names), text, normHash: hashText(text) };
  });
}

// Finds the longest run at the end of the stored thread that also appears,
// unbroken, in the paste. Everything in the paste after that run is new. Among
// equally long matches the earliest wins, since a paste normally starts at the
// part of the thread it overlaps.
function overlapEnd(storedHashes: string[], pasteHashes: string[]): number {
  const maxRun = Math.min(storedHashes.length, pasteHashes.length);
  for (let run = maxRun; run >= 1; run--) {
    const tail = storedHashes.slice(storedHashes.length - run);
    for (let start = 0; start + run <= pasteHashes.length; start++) {
      if (tail.every((hash, offset) => pasteHashes[start + offset] === hash)) return start + run;
    }
  }
  return 0;
}

export function mergePaste(
  stored: StoredMessageRef[],
  paste: string,
  selfNames: readonly string[] = [],
): MergeResult {
  const blocks = parsePaste(paste, selfNames);
  if (blocks.length === 0) return { appended: [], skippedDuplicates: 0 };

  // Replies picked in this app are already in the thread as the writer's own.
  // The same reply coming back in a paste, maybe edited a little or wrapped in
  // a timestamp, is a copy of it and not a new message.
  const ownReplies = stored
    .filter((message) => message.source === "chosen_reply" && message.author === "me")
    .map((message) => ({ text: normalizeForHash(message.text), normHash: message.normHash }))
    .filter((own) => own.text.length >= MIN_OWN_REPLY_CHARS);
  const ownReplyIn = (block: MergeBlock) => {
    const text = normalizeForHash(block.text);
    return ownReplies.find((own) => text === own.text || text.includes(own.text));
  };

  // A copy of an own reply is compared as the stored message itself, so a
  // lightly edited reply does not break the overlap with the stored thread.
  const matchHashes = blocks.map((block) => ownReplyIn(block)?.normHash ?? block.normHash);
  const matchedUpTo = overlapEnd(
    stored.map((message) => message.normHash),
    matchHashes,
  );

  let skippedDuplicates = matchedUpTo;
  const appended: MergeBlock[] = [];
  for (const block of blocks.slice(matchedUpTo)) {
    if (ownReplyIn(block)) skippedDuplicates += 1;
    else appended.push(block);
  }
  return { appended, skippedDuplicates };
}
