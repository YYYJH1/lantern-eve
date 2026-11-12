/**
 * What changed between one telling of a story and the one before it, for the ending page's tree of a rumour: choosing a telling there marks the
 * words that are new in it. The unit of a text is the character in Chinese and the word in English. The marks are the units that the longest common
 * run of the two texts leaves out, so the part of a telling that was passed on as it was stays plain and what was added or put in place of something
 * else is marked; the units of the earlier telling that are gone are marked in it. Marks of punctuation are not made.
 *
 * It has no PixiJS and no page in it, so that the tests can run it without a browser.
 */
import type { Lang } from "../i18n/index.ts";
import type { Telling } from "./ending.ts";

/** A stretch of a text, and whether it is one that changed. The stretches of a text, put one after the other, are the text. */
export interface Run {
  text: string;
  changed: boolean;
}

export interface WordsDiff {
  /** The earlier telling, with the stretches that are gone from the later one marked. */
  before: Run[];
  /** The later telling, with the stretches that are new in it marked. */
  after: Run[];
  /** Whether the two tellings say the same, so that nothing is marked in either. */
  same: boolean;
}

interface Unit {
  text: string;
  /** What two units are compared by: the character, or the word without its marks and its capital. Empty for punctuation, which is never marked. */
  key: string;
}

const PUNCTUATION = /[\p{P}\p{S}\s]/u;

/** The units of a text: the characters of a Chinese text, the words of an English one with the space after each, so that the units put together are the text. */
export function units(text: string, lang: Lang): Unit[] {
  if (lang === "zh") return Array.from(text, (char) => ({ text: char, key: PUNCTUATION.test(char) ? "" : char }));
  const out: Unit[] = [];
  for (const match of text.matchAll(/\S+\s*|\s+/gu)) {
    const word = match[0];
    const key = word.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "").toLowerCase();
    out.push({ text: word, key });
  }
  return out;
}

/** Which units of `a` and of `b` the longest common run keeps, by the classic table of lengths. */
function keptBy(a: readonly string[], b: readonly string[]): { a: boolean[]; b: boolean[] } {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? (table[i + 1]![j + 1] as number) + 1 : Math.max(table[i + 1]![j] as number, table[i]![j + 1] as number);
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepA[i] = true;
      keepB[j] = true;
      i++;
      j++;
    } else if ((table[i + 1]![j] as number) >= (table[i]![j + 1] as number)) {
      i++;
    } else {
      j++;
    }
  }
  return { a: keepA, b: keepB };
}

/**
 * In Chinese a single character that two tellings share between two stretches that changed is not worth leaving plain (the same 家 or 的 turns up
 * by chance), so it is marked with them. `content` says which units count: punctuation does not break a stretch.
 */
function smoothed(changed: boolean[], content: readonly boolean[]): boolean[] {
  const out = [...changed];
  const idx = content.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  for (let k = 1; k < idx.length - 1; k++) {
    const here = idx[k] as number;
    if (!changed[here] && changed[idx[k - 1] as number] && changed[idx[k + 1] as number]) out[here] = true;
  }
  return out;
}

/** The units put together in runs that are all changed or all plain. */
function runsOf(parts: readonly Unit[], changed: readonly boolean[]): Run[] {
  const out: Run[] = [];
  parts.forEach((part, i) => {
    const mark = changed[i] === true;
    const last = out[out.length - 1];
    if (last !== undefined && last.changed === mark) last.text += part.text;
    else out.push({ text: part.text, changed: mark });
  });
  return out;
}

/** The two tellings side by side, with what changed marked in each. */
export function diffWords(before: string, after: string, lang: Lang): WordsDiff {
  const a = units(before, lang);
  const b = units(after, lang);
  // Punctuation is left out of the comparison and never marked.
  const ca = a.map((u) => u.key !== "");
  const cb = b.map((u) => u.key !== "");
  const ia = a.map((_, i) => i).filter((i) => ca[i]);
  const ib = b.map((_, i) => i).filter((i) => cb[i]);
  const kept = keptBy(
    ia.map((i) => (a[i] as Unit).key),
    ib.map((i) => (b[i] as Unit).key),
  );
  const changedA = a.map(() => false);
  const changedB = b.map(() => false);
  ia.forEach((i, k) => {
    changedA[i] = !kept.a[k];
  });
  ib.forEach((i, k) => {
    changedB[i] = !kept.b[k];
  });
  const markA = lang === "zh" ? smoothed(changedA, ca) : changedA;
  const markB = lang === "zh" ? smoothed(changedB, cb) : changedB;
  return { before: runsOf(a, markA), after: runsOf(b, markB), same: !markA.some(Boolean) && !markB.some(Boolean) };
}

/**
 * The telling a telling follows: the one by which its speaker heard the story, which is the latest telling to them before they said it. Null for
 * someone who knew it first-hand, whose telling is where the story starts.
 */
export function previousTelling(told: readonly Telling[], telling: Telling): Telling | null {
  let found: Telling | null = null;
  for (const earlier of told) {
    if (earlier.id === telling.id || earlier.to !== telling.from) continue;
    if (earlier.tick > telling.tick) continue;
    if (found === null || earlier.tick >= found.tick) found = earlier;
  }
  return found;
}
