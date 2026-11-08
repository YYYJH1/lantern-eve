/**
 * Every key that has been set in this JavaScript context, so that text on its way to a log, an
 * error report or the page can be scrubbed of it. Keys are never removed: a key that was replaced
 * or cleared must stay out of the logs just the same.
 */
const known = new Set<string>();

/** Real keys are far longer than this. Shorter strings would corrupt unrelated text. */
const MIN_REDACTED_LENGTH = 8;

export function registerSecret(value: string): void {
  if (value.length >= MIN_REDACTED_LENGTH) known.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const secret of known) {
    if (out.includes(secret)) out = out.split(secret).join("[key]");
  }
  return out;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return redact(`${err.name}: ${err.message}`);
  return redact(String(err));
}
