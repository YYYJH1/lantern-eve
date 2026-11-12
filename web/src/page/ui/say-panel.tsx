import { useState } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { Offer } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import { CloseCorner, InkAct } from "./ink.tsx";
import { Picker, type PickerOption } from "./picker.tsx";
import { sourceWords } from "./source-text.ts";

/** How a line of the notebook is told: as it stands, or as if the manager had seen it themselves. */
export type Telling = "faithful" | "as_seen";

export interface SayPanelProps {
  entries: readonly NotebookEntry[];
  /** What the town puts forward to tell (`player.offers.tell`): for each line, the telling as it is and, where the manager did not see it, the telling as if seen. */
  offers: readonly Offer[];
  lang: Lang;
  /** The name of the person talked to, whom the line is told to. */
  name: string;
  /** An act is being paid for: the lines wait. */
  disabled: boolean;
  onTell(entry: NotebookEntry, how: Telling): void;
  onClose(): void;
}

/** Whether the town lets the manager tell this line as if they had seen it: it does not for a line they saw. */
export const canTellAsSeen = (offers: readonly Offer[], entry: NotebookEntry): boolean => offers.some((offer) => offer.id === `${entry.id}:as_seen`);

/**
 * What to tell: a line of the notebook, and then how. Telling it as it is, the default, is the only way for a line the manager saw themselves.
 * Telling it as if seen is a lie where the manager did not see it, and the card says what that risks.
 */
export function SayPanel({ entries, offers, lang, name, disabled, onTell, onClose }: SayPanelProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const entry = picked === null ? undefined : entries.find((e) => e.id === picked);
  if (entry === undefined) {
    const options: PickerOption[] = entries.map((e) => ({ id: e.id, label: pick(e.text, lang), badge: sourceWords(e.source, lang) ?? undefined, name: e.text }));
    return (
      <Picker
        inline
        testId="picker-tell"
        title={t("say.title", { name })}
        groups={[{ id: "notebook", title: "", options }]}
        empty={t("say.empty")}
        onPick={(option) => {
          const found = entries.find((e) => e.id === option.id);
          if (found === undefined) return;
          // A line the manager saw can be told one way, so there is nothing to choose.
          if (canTellAsSeen(offers, found)) setPicked(found.id);
          else onTell(found, "faithful");
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <section class="picker paper-slip say-how" data-testid="say-how" data-entry={entry.id} role="dialog" aria-label={t("say.how")}>
      <CloseCorner label={t("picker.close")} testid="picker-close" onClose={onClose} />
      <header class="picker-head">
        <h3 class="picker-title">{t("say.how")}</h3>
      </header>
      <p class="say-line" data-testid="say-line">
        {pick(entry.text, lang)}
      </p>
      <div class="say-choices">
        <InkAct seed={`faithful-${entry.id}`} data-testid="tell-faithful" disabled={disabled} onClick={() => onTell(entry, "faithful")}>
          {t("say.faithful")}
        </InkAct>
        <InkAct seed={`seen-${entry.id}`} data-testid="tell-as_seen" disabled={disabled} onClick={() => onTell(entry, "as_seen")}>
          {t("say.asSeen")}
        </InkAct>
        <InkAct seed={`back-${entry.id}`} data-testid="tell-back" onClick={() => setPicked(null)}>
          {t("say.back")}
        </InkAct>
      </div>
      <p class="say-risk" data-testid="say-risk">
        {t("say.asSeen.risk", { name })}
      </p>
    </section>
  );
}
