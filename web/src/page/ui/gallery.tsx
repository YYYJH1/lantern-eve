import { useEffect, useState } from "preact/hooks";
import { getLang, type Lang, type MessageKey, t } from "../../i18n/index.ts";
import type { ThemeChoice } from "../prefs.ts";
import { type Gallery, type GalleryEntry, listGallery, sizeText } from "../replays.ts";
import { CloseIcon, ReplayIcon } from "./icons.tsx";
import { LanguageSwitch, ThemeSwitch } from "./topbar.tsx";

function whenText(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (iso === "" || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function Entry({ entry, lang, opening, onWatch }: { entry: GalleryEntry; lang: Lang; opening: string | null; onWatch: (entry: GalleryEntry) => void }) {
  const title = entry.source === "server" && entry.seed !== null ? t("gallery.seed", { seed: entry.seed }) : entry.title;
  const meta = [
    t("gallery.ticks", { n: entry.ticks }),
    entry.scenario,
    entry.bytes === null ? null : sizeText(entry.bytes),
    entry.coreVersion === null ? null : t("gallery.core", { version: entry.coreVersion }),
    whenText(entry.when, lang),
  ].filter((part): part is string => part !== null && part !== "");
  return (
    <li class="gallery-entry" data-testid="gallery-entry" data-id={entry.id} data-source={entry.source}>
      <span class="gallery-icon" aria-hidden="true">
        <ReplayIcon />
      </span>
      <div class="gallery-text">
        <strong class="gallery-name" data-testid="gallery-name">
          {title}
        </strong>
        <span class="gallery-meta" data-testid="gallery-meta">
          {meta.join(lang === "zh" ? "，" : ", ")}
        </span>
      </div>
      <button type="button" class="btn btn-primary" data-testid="gallery-watch" disabled={opening !== null} onClick={() => onWatch(entry)}>
        {opening === entry.id ? t("gallery.opening") : t("gallery.watch")}
      </button>
    </li>
  );
}

function Section({ id, title, empty, entries, lang, opening, onWatch }: { id: string; title: string; empty: string; entries: GalleryEntry[]; lang: Lang; opening: string | null; onWatch: (entry: GalleryEntry) => void }) {
  return (
    <section class="gallery-section" data-testid={`gallery-${id}`}>
      <h3 class="gallery-heading">
        {title}
        <span class="count">{entries.length}</span>
      </h3>
      {entries.length === 0 ? (
        <p class="gallery-empty" data-testid={`gallery-${id}-empty`}>
          {empty}
        </p>
      ) : (
        <ul class="gallery-list">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} lang={lang} opening={opening} onWatch={onWatch} />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface GalleryViewProps {
  lang: Lang;
  theme: ThemeChoice;
  /** The id of the recording that is being opened, if one is. */
  opening: string | null;
  /** Why the last recording could not be opened, as the key of the sentence that says so. */
  failure: MessageKey | null;
  onWatch: (entry: GalleryEntry) => void;
  onClose: () => void;
  /** A recording is open over the gallery, which then answers no key. */
  covered?: boolean;
}

/** The recordings the page can reach, in the two places that keep them, and a button to watch each. */
export function GalleryView({ lang, theme, opening, failure, onWatch, onClose, covered = false }: GalleryViewProps) {
  const [found, setFound] = useState<Gallery | null>(null);
  useEffect(() => {
    let live = true;
    void listGallery().then((gallery) => {
      if (live) setFound(gallery);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (covered) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, covered]);
  return (
    <div class="gallery" data-testid="gallery" role="dialog" aria-modal="true" aria-label={t("gallery.title")} lang={getLang() === "zh" ? "zh-CN" : "en"}>
      <header class="gallery-head">
        <span class="gallery-head-icon" aria-hidden="true">
          <ReplayIcon />
        </span>
        <h2>{t("gallery.title")}</h2>
        <div class="gallery-gap" />
        <LanguageSwitch lang={lang} />
        <ThemeSwitch theme={theme} />
        <button type="button" class="btn" data-testid="gallery-close" onClick={onClose}>
          <CloseIcon />
          <span>{t("gallery.back")}</span>
        </button>
      </header>
      <div class="gallery-body">
        <p class="gallery-intro">{t("gallery.intro")}</p>
        {failure === null ? null : (
          <p class="gallery-failure" data-testid="gallery-failure" role="alert">
            {t(failure)}
          </p>
        )}
        {found === null ? (
          <p class="gallery-empty" data-testid="gallery-loading">
            {t("gallery.loading")}
          </p>
        ) : (
          <>
            <Section id="browser" title={t("gallery.browser")} empty={t("gallery.emptyBrowser")} entries={found.browser} lang={lang} opening={opening} onWatch={onWatch} />
            {found.server === null ? null : <Section id="server" title={t("gallery.server")} empty={t("gallery.emptyServer")} entries={found.server} lang={lang} opening={opening} onWatch={onWatch} />}
          </>
        )}
      </div>
    </div>
  );
}
