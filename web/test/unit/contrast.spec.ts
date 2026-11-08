import { expect, test } from "@playwright/test";
import { contrastOf, FRAME_CSS, parseHex, type Rgb, type Rule, rulesOf, valueOf } from "../support/css-rules.ts";

// Every colour that text is set in is at least 4.5 to 1 on the paper (or the wall, or the slip) it is set on, in both themes. 墨灰 (and
// the other colours of the lines) draws lines and is never the colour of a word. The colours are read from tokens.css, with the roles
// resolved the way the browser does: the dark theme is the default, and the light one is the roles that `:root[data-theme="light"]` sets.

type Tokens = Map<string, string>;

function tokensFor(theme: "dark" | "light"): Tokens {
  const tokens: Tokens = new Map();
  const rules: Rule[] = rulesOf("tokens.css");
  for (const rule of rules) {
    const selected = rule.selector === ":root" || (theme === "light" && rule.selector === ':root[data-theme="light"]');
    if (!selected || rule.at !== null) continue;
    for (const decl of rule.decls) if (decl.prop.startsWith("--")) tokens.set(decl.prop, decl.value);
  }
  return tokens;
}

/** The colour a token comes to: a hex, a var() of another token, or the colour-mix() of two of them. */
function resolve(tokens: Tokens, value: string, depth = 0): Rgb {
  if (depth > 12) throw new Error(`too deep: ${value}`);
  const text = value.trim();
  if (text.startsWith("#")) return parseHex(text);
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(text);
  if (reference !== null) {
    const next = tokens.get(reference[1] ?? "");
    if (next === undefined) throw new Error(`${reference[1]} is not defined`);
    return resolve(tokens, next, depth + 1);
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)(?:\s*)$/.exec(text);
  if (mix !== null) {
    const share = Number(mix[2]) / 100;
    const a = resolve(tokens, mix[1] ?? "", depth + 1);
    const b = resolve(tokens, mix[3] ?? "", depth + 1);
    return { r: a.r * share + b.r * (1 - share), g: a.g * share + b.g * (1 - share), b: a.b * share + b.b * (1 - share) };
  }
  throw new Error(`cannot resolve ${value}`);
}

/** Text colour, then the colour it is set on, and where. */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ["--ink", "--paper", "text on paper: the slip, the ledger, the strip, the cards"],
  ["--ink-strong", "--paper", "the same, in the older name"],
  ["--muted", "--paper", "smaller text is ink as well"],
  ["--faint", "--paper", "the quietest text is ink as well"],
  ["--paper-ink", "--paper", "text on the notebook"],
  ["--paper-muted", "--paper", "smaller text on the notebook"],
  ["--seal-ink", "--paper", "a word in the colour of the seal"],
  ["--base-ink", "--base", "the placard on the wall"],
  ["--on-slip", "--slip", "the name of the task on the slip"],
  ["--paper", "--ink", "a control that is ink with the paper written on it"],
  ["--accent-ink", "--accent", "the primary button"],
  ["--base-ink", "--bg", "text laid straight on the page"],
];

for (const theme of ["dark", "light"] as const) {
  test(`${theme} theme: every text colour is 4.5 to 1 on what it is set on`, () => {
    const tokens = tokensFor(theme);
    const low: string[] = [];
    for (const [text, ground, what] of PAIRS) {
      const ratio = contrastOf(resolve(tokens, `var(${text})`), resolve(tokens, `var(${ground})`));
      if (ratio < 4.5) low.push(`${text} on ${ground} (${what}): ${ratio.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });
}

test("the colours of lines are never the colour of a word", () => {
  // The tokens of the lines, and of the marks (竹青 is for ticks and tallies, which are drawings): none is a `color:` of the frame, except on the
  // elements that hold nothing but a drawing.
  const LINES = /var\(--(mohui|rule|line|line-strong|paper-line|paper-edge|zhuqing|tick|structure|dailan)\)/;
  const DRAWINGS_ONLY = [".lrow-mark", ".ledger .stars", ".tally", ".act-mark", ".board-state .tick", ".statement-picked", ".slip-tick", ".strike-mark", ".ledger-rule", ".lrow-rule"];
  const hits: string[] = [];
  for (const rule of FRAME_CSS.flatMap((file) => rulesOf(file))) {
    const color = valueOf(rule, "color");
    if (color !== undefined && LINES.test(color) && !rule.selector.split(",").every((s) => DRAWINGS_ONLY.includes(s.trim()))) hits.push(`${rule.file}: ${rule.selector} color: ${color}`);
  }
  expect(hits).toEqual([]);
});
