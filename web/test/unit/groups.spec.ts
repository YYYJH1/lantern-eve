import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// The browser specs run in groups named in test/groups: fake.txt and real.txt hold every spec of test/e2e once, and each is cut into parts
// (fake-1.txt, real-1.txt, ...) that take about the same time on the two cores of a CI runner. A spec that is in no list would never run in CI,
// so the lists are held to the specs, the parts to the lists and the workflow to the parts.
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GROUPS = path.join(WEB, "test/groups");

const lines = (file: string): string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const list = (name: string): string[] => lines(path.join(GROUPS, `${name}.txt`));
const kinds = ["fake", "real"] as const;
const partsOf = (kind: string): string[] =>
  readdirSync(GROUPS)
    .map((file) => /^(fake|real)-(\d+)\.txt$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null && match[1] === kind)
    .sort((a, b) => Number(a[2]) - Number(b[2]))
    .map((match) => match[0].replace(/\.txt$/, ""));

const sorted = (names: string[]): string[] => [...names].sort();
const twice = (names: string[]): string[] => names.filter((name, i) => names.indexOf(name) !== i);

test.describe("the groups of the browser specs", () => {
  test("hold every spec of test/e2e once, in the list of its kind", () => {
    const specs = readdirSync(path.join(WEB, "test/e2e")).filter((file) => file.endsWith(".spec.ts"));
    const listed = kinds.flatMap((kind) => list(kind));
    expect(twice(listed), "a spec in two lists").toEqual([]);
    expect(sorted(listed)).toEqual(sorted(specs));
  });

  for (const kind of kinds) {
    test(`${kind}.txt is the sum of its parts, each spec in one part`, () => {
      const parts = partsOf(kind);
      expect(parts.length, `the parts of ${kind}`).toBeGreaterThan(0);
      parts.forEach((part, i) => expect(part, "the parts are numbered from 1 without a gap").toBe(`${kind}-${i + 1}`));
      const listed = parts.flatMap((part) => list(part));
      expect(twice(listed), "a spec in two parts").toEqual([]);
      expect(sorted(listed)).toEqual(sorted(list(kind)));
    });
  }

  test("are all run by the workflow, and nothing else is", () => {
    const workflow = readFileSync(path.resolve(WEB, "../.github/workflows/ci.yml"), "utf8");
    const named = /group:\s*\[([^\]]*)\]/.exec(workflow);
    expect(named, "the matrix of the web job names its groups").not.toBeNull();
    const run = (named?.[1] ?? "").split(",").map((name) => name.trim());
    expect(sorted(run)).toEqual(sorted(kinds.flatMap((kind) => partsOf(kind))));
  });
});
