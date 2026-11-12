import { type Lang, pick, t } from "../../i18n/index.ts";
import type { NoteSource } from "../notebook.ts";

/**
 * Where a line of the notebook came from, said the way a person would say it: seen with one's own eyes, or the teller and what the
 * teller said of how they know it (they saw it, they heard it from somebody they name, they cannot say from whom). There is no count of
 * hands in it, and the notebook sends none.
 */
export function sourceWords(source: NoteSource, lang: Lang): string {
  if (source.kind === "seen") return t("source.seen");
  if (source.kind === "unknown") return t("source.unknown");
  const who = pick(source.who, lang);
  if (source.how === "saw") return t("source.told.saw", { who });
  if (source.how === "heard" && source.via !== null) return t("source.told.via", { who, via: pick(source.via, lang) });
  return t("source.told.unsure", { who });
}
