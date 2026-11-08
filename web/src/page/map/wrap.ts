/** Marks that do not start a line in Chinese, and marks that do not end one. */
const NO_START = new Set([..."，。、；：！？）】」』”’…·"]);
const NO_END = new Set([..."（【「『“‘"]);

/**
 * Breaks Chinese text into lines of at most `max` pixels. A line may break between any two
 * characters, except that no line starts with a closing mark or ends with an opening one, so a
 * full stop is never left alone on a line of its own.
 */
export function wrapChinese(text: string, max: number, measure: (char: string) => number): string {
  const lines: string[] = [];
  let line: string[] = [];
  let used = 0;
  for (const char of text) {
    const width = measure(char);
    if (line.length > 0 && used + width > max && !NO_START.has(char)) {
      const last = line[line.length - 1] as string;
      if (NO_END.has(last) && line.length > 1) {
        line.pop();
        lines.push(line.join(""));
        line = [last, char];
        used = measure(last) + width;
      } else {
        lines.push(line.join(""));
        line = [char];
        used = width;
      }
      continue;
    }
    line.push(char);
    used += width;
  }
  if (line.length > 0) lines.push(line.join(""));
  return lines.join("\n");
}
