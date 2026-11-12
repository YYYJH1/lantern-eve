import { useEffect, useRef, useState } from "preact/hooks";
import { getLang, type Lang, type MessageKey, t } from "../../i18n/index.ts";
import type { ProviderId, SaveMeta } from "../../shared/protocol.ts";
import { PROVIDER_IDS, PROVIDERS } from "../../shared/providers.ts";
import { SoundSection } from "../audio/sound-menu.tsx";
import { HostCallError, type HostClient, type PageState } from "../client.ts";
import type { ViewFrame } from "../frame.ts";
import { loadFailureOf } from "../load-failure.ts";
import type { Play } from "../play.ts";
import type { ThemeChoice } from "../prefs.ts";
import { failureOf, failureText, type SaveFailure } from "../save-notice.ts";
import { forget, type Remembered, remember } from "../storage.ts";
import { CallLog } from "./calls.tsx";
import { GuidanceSwitch, HintList } from "./guide.tsx";
import { tickText } from "./format.ts";
import { CloseCorner } from "./ink.tsx";
import { CostCard } from "./side.tsx";
import { LanguageSwitch, type SpeedChoice, SpeedSwitch, ThemeSwitch } from "./topbar.tsx";

const ms = (value: number | undefined): string => (value === undefined ? "-" : value.toFixed(2));

/** What a save is called in the list: its name and the game time it was made at. A name that says the time already (an autosave's) is not followed by it. */
function saveText(save: SaveMeta): string {
  const when = tickText(getLang(), save.tick);
  if (save.name === "") return when;
  return save.name.includes(when) ? save.name : t("menu.saveOption", { name: save.name, when });
}

function describe(err: unknown): string {
  if (err instanceof HostCallError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * What the menu says of the last thing it did. It keeps what the words are made of and not the words, so that a change of language changes them where
 * they stand: a failed save keeps its kind, and the host's own words (a code and what it found) are shown as the host gave them.
 */
type Said =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "message"; key: MessageKey; values?: Record<string, string | number>; tick?: number }
  | { kind: "save-failed"; failure: SaveFailure }
  /** A save that another version of the game made: said in plain words, with the host's own words after them. */
  | { kind: "load-version"; text: string };

const hostSaid = (err: unknown): Said => ({ kind: "text", text: describe(err) });

/** The words of a notice, in the language of the page now: the plain ones, and the host's own after them where it has any to add. */
function saidWords(said: Said): { plain: string; detail: string } {
  switch (said.kind) {
    case "none":
      return { plain: "", detail: "" };
    case "text":
      return { plain: said.text, detail: "" };
    case "message":
      // A tick is said as the day and the hour of the game, in the language of the page now.
      return { plain: t(said.key, said.tick === undefined ? said.values : { ...said.values, when: tickText(getLang(), said.tick) }), detail: "" };
    case "save-failed":
      return { plain: failureText(said.failure), detail: "" };
    case "load-version":
      return { plain: t("menu.load.version"), detail: said.text };
  }
}

function Details({ s }: { s: PageState }) {
  const stats = s.stats;
  const m = stats?.models;
  const last = stats?.lastModel ?? null;
  return (
    <details class="menu-section" data-testid="details">
      <summary class="menu-heading">{t("menu.details")}</summary>
      <dl class="facts">
        <div>
          <dt>{t("detail.tick")}</dt>
          <dd data-testid="tick">{s.simTick}</dd>
        </div>
        <div>
          <dt>{t("detail.hash")}</dt>
          <dd class="mono" data-testid="hash" data-tick={s.hashTick ?? ""} data-hash={s.hash ?? ""}>
            {s.hash === null ? "-" : `${s.hash.slice(0, 16)}… @ ${s.hashTick}`}
          </dd>
        </div>
        <div>
          <dt>{t("detail.rate")}</dt>
          <dd data-testid="rate">
            {s.rate[0]}/{s.rate[1]}
          </dd>
        </div>
        <div>
          <dt>{t("detail.seed")}</dt>
          <dd data-testid="seed">{s.seed}</dd>
        </div>
        <div>
          <dt>{t("detail.load")}</dt>
          <dd data-testid="load-time">
            {s.ready === null
              ? "-"
              : t("tick.value", {
                  ms: Math.round(s.ready.timings.totalMs),
                  detail: t("tick.detail", {
                    runtime: Math.round(s.ready.timings.pyodideMs),
                    wheel: Math.round(s.ready.timings.wheelMs),
                    core: Math.round(s.ready.timings.coreMs),
                  }),
                })}
          </dd>
        </div>
        <div>
          <dt>{t("detail.step")}</dt>
          <dd data-testid="step-cost">{stats === null ? "-" : t("tick.step", { mean: ms(stats.pyMeanMs), p95: ms(stats.pyP95Ms), max: ms(stats.pyMaxMs) })}</dd>
        </div>
      </dl>
      <h3 class="menu-subheading">{t("menu.models")}</h3>
      <dl class="facts">
        <div>
          <dt>{t("model.started")}</dt>
          <dd data-testid="m-started">{m?.started ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.ok")}</dt>
          <dd data-testid="m-ok">{m?.ok ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.error")}</dt>
          <dd data-testid="m-error">{m?.error ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.timeout")}</dt>
          <dd data-testid="m-timeout">{m?.timeout ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.cancelled")}</dt>
          <dd data-testid="m-cancelled">{m?.cancelled ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.inflight")}</dt>
          <dd data-testid="m-inflight">{m?.inflight ?? 0}</dd>
        </div>
        <div>
          <dt>{t("model.last")}</dt>
          <dd class="mono" data-testid="m-last">
            {last === null
              ? "-"
              : `${last.status}${last.code === undefined ? "" : ` ${last.code}`}, ${last.latency_ms} ms, ${last.input_tokens} in, ${last.output_tokens} out`}
          </dd>
        </div>
      </dl>
      <h3 class="menu-subheading">{t("menu.events")}</h3>
      <pre class="mono events" data-testid="events">
        {s.events
          .slice(-6)
          .map((event) => JSON.stringify(event))
          .join("\n")}
      </pre>
    </details>
  );
}

function Controls({ client, play, s, open, onReplays }: { client: HostClient; play: Play; s: PageState; open: boolean; onReplays?: () => void }) {
  const [notice, setNotice] = useState<Said>({ kind: "none" });
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number | "">("");
  const ready = s.phase === "ready";
  const said = saidWords(notice);

  useEffect(() => {
    if (ready) void client.refreshSaves().catch((err: unknown) => setNotice(hostSaid(err)));
  }, [client, ready]);

  useEffect(() => {
    if (selected === "" && s.saves[0] !== undefined) setSelected(s.saves[0].id);
  }, [s.saves, selected]);

  // The words of a save that could not be made count as telling the player once they are on screen, which is when the menu is open: a failure that came back after the
  // menu was shut has told nobody, and the page tells it again where it can (over the map).
  useEffect(() => {
    if (open && notice.kind === "save-failed") play.saveFailureTold(notice.failure);
  }, [open, notice, play]);

  /** Runs what a button does and shows what came of it where the menu shows its results: `failed` is the words for the error, which are the host's own unless the button has better. */
  const run = (work: () => Promise<Said>, failed: (err: unknown) => Said = hostSaid) => () => {
    work().then(setNotice, (err: unknown) => setNotice(failed(err)));
  };

  const exportReplay = async (): Promise<Said> => {
    const replay = await client.exportReplay();
    const blob = new Blob([JSON.stringify(replay)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lantern-replay-seed${replay.header.seed}-tick${replay.end_tick}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { kind: "message", key: "notice.exported", tick: replay.end_tick };
  };

  return (
    <>
      <section class="menu-section">
        <h3 class="menu-heading">{t("menu.game")}</h3>
        <div class="row">
          <button type="button" class="btn" data-testid="btn-new" disabled={!ready} onClick={() => client.newGame()}>
            {t("menu.newGame")}
          </button>
          <button type="button" class="btn" data-testid="btn-export" disabled={!ready} onClick={run(exportReplay)}>
            {t("menu.export")}
          </button>
          {onReplays === undefined ? null : (
            <button type="button" class="btn" data-testid="btn-replays" onClick={onReplays}>
              {t("menu.replays")}
            </button>
          )}
        </div>
      </section>
      <section class="menu-section">
        <h3 class="menu-heading">{t("menu.saves")}</h3>
        <div class="row">
          <input
            type="text"
            data-testid="save-name"
            placeholder={t("menu.saveName")}
            aria-label={t("menu.saveName")}
            value={name}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn"
            data-testid="btn-save"
            disabled={!ready}
            onClick={run(
              async () => {
                const meta = await play.saveByHand(name);
                setName("");
                setSelected(meta.id);
                return { kind: "message", key: "notice.saved", tick: meta.tick };
              },
              (err) => ({ kind: "save-failed", failure: failureOf(err) }),
            )}
          >
            {t("menu.save")}
          </button>
        </div>
        <div class="row">
          <select data-testid="select-saves" aria-label={t("menu.saves")} value={selected} onChange={(event) => setSelected(Number((event.target as HTMLSelectElement).value))}>
            {s.saves.length === 0 ? <option value="">{t("menu.noSaves")}</option> : null}
            {s.saves.map((save) => (
              <option key={save.id} value={save.id}>
                {saveText(save)}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn"
            data-testid="btn-load"
            disabled={!ready || selected === ""}
            onClick={run(
              async () => {
                if (selected === "") return { kind: "none" };
                const info = await client.load(selected);
                return { kind: "message", key: info.match ? "notice.loadedMatch" : "notice.loadedDiffer", tick: info.tick };
              },
              // A save that another version of the game made is said in plain words, and the host's own words follow them.
              (err) => (loadFailureOf(err) === "version" ? { kind: "load-version", text: describe(err) } : hostSaid(err)),
            )}
          >
            {t("menu.load")}
          </button>
          <button
            type="button"
            class="btn"
            data-testid="btn-delete"
            disabled={!ready || selected === ""}
            onClick={run(async () => {
              if (selected === "") return { kind: "none" };
              await client.deleteSave(selected);
              setSelected("");
              return { kind: "message", key: "notice.deleted" };
            })}
          >
            {t("menu.delete")}
          </button>
        </div>
        <p class="notice" data-testid="notice" role="status" data-kind={notice.kind}>
          {said.plain}
          {said.detail === "" ? null : <span class="notice-detail">{said.detail}</span>}
        </p>
        {s.loaded === null ? null : (
          <dl class="facts">
            <div>
              <dt>{t("menu.load")}</dt>
              <dd
                data-testid="loaded"
                data-match={String(s.loaded.match)}
                data-hash={s.loaded.hash}
                data-saved-hash={s.loaded.savedHash}
                data-tick={s.loaded.tick}
                class={s.loaded.match ? "ok" : "bad"}
              >
                {t("notice.loadedLine", {
                  when: tickText(getLang(), s.loaded.tick),
                  state: t(s.loaded.match ? "notice.hashMatches" : "notice.hashDiffers"),
                })}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </>
  );
}

function Provider({ client, initial }: { client: HostClient; initial: Remembered | null }) {
  const [provider, setProvider] = useState<ProviderId | "">(initial?.provider ?? "");
  const [model, setModel] = useState(initial?.model ?? PROVIDERS.ollama.models.cheap);
  const [key, setKey] = useState("");
  const [keep, setKeep] = useState(initial !== null);
  const [keySet, setKeySet] = useState<Partial<Record<ProviderId, boolean>>>(initial === null ? {} : { [initial.provider]: true });
  const spec = provider === "" ? null : PROVIDERS[provider];

  const apply = (): void => {
    const typed = key.trim();
    client.configure({
      provider: provider === "" ? null : provider,
      key: typed === "" ? undefined : typed,
      model: provider === "ollama" ? model : undefined,
    });
    if (provider !== "" && typed !== "") {
      setKeySet({ ...keySet, [provider]: true });
      if (keep) remember({ provider, key: typed, model: provider === "ollama" ? model : undefined });
    }
    setKey("");
  };

  const clearKey = (): void => {
    if (provider === "") return;
    client.configure({ provider, key: "" });
    setKeySet({ ...keySet, [provider]: false });
    forget();
    setKey("");
  };

  return (
    <section class="menu-section">
      <h3 class="menu-heading">{t("menu.provider")}</h3>
      <div class="row">
        <select
          data-testid="select-provider"
          aria-label={t("menu.provider")}
          value={provider}
          onChange={(event) => {
            const next = (event.target as HTMLSelectElement).value as ProviderId | "";
            setProvider(next);
            client.configure({
              provider: next === "" ? null : next,
              model: next === "ollama" ? model : undefined,
            });
          }}
        >
          <option value="">{t("menu.offline")}</option>
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].label}
            </option>
          ))}
        </select>
      </div>
      {provider === "ollama" ? (
        <div class="row">
          <input type="text" data-testid="input-model" aria-label={t("menu.localModel")} value={model} onInput={(event) => setModel((event.target as HTMLInputElement).value)} />
        </div>
      ) : null}
      {spec?.needsKey ? (
        <>
          <div class="row">
            <input
              type="password"
              data-testid="input-key"
              aria-label={t("menu.apiKey")}
              placeholder={keySet[spec.id] ? t("menu.keyForSession") : t("menu.apiKey")}
              autocomplete="off"
              spellcheck={false}
              value={key}
              onInput={(event) => setKey((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="row">
            <label>
              <input
                type="checkbox"
                data-testid="chk-remember"
                checked={keep}
                onChange={(event) => {
                  const on = (event.target as HTMLInputElement).checked;
                  setKeep(on);
                  if (!on) forget();
                }}
              />
              {t("menu.remember")}
            </label>
          </div>
        </>
      ) : null}
      <div class="row">
        <button type="button" class="btn" data-testid="btn-apply" onClick={apply}>
          {t("menu.apply")}
        </button>
        {spec?.needsKey ? (
          <button type="button" class="btn" data-testid="btn-clear-key" onClick={clearKey}>
            {t("menu.clearKey")}
          </button>
        ) : null}
        <span data-testid="key-state" class="mono">
          {spec === null ? "" : spec.needsKey ? (keySet[spec.id] ? t("menu.keyHeld") : t("menu.noKey")) : t("menu.noKeyNeeded")}
        </span>
      </div>
    </section>
  );
}

/** The choices about how the page looks and runs: its language and its theme, and the speed of the day. */
function Look({ lang, theme, speed }: { lang: Lang; theme: ThemeChoice; speed: MenuSpeed | null }) {
  return (
    <section class="menu-section" data-testid="menu-look">
      <h3 class="menu-heading">{t("menu.look")}</h3>
      <div class="row">
        <LanguageSwitch lang={lang} />
        <ThemeSwitch theme={theme} />
      </div>
      {speed === null ? null : (
        <div class="row">
          <SpeedSwitch speed={speed.value} onSpeed={speed.onChange} disabled={speed.disabled} />
        </div>
      )}
    </section>
  );
}

/** What helps the player: the hints of the world, how much the task card does, and the tutorial of the first day, which can be played again. */
function Help({ play, client, s, lang, onClose }: { play: Play; client: HostClient; s: PageState; lang: Lang; onClose: () => void }) {
  const guide = play.guide;
  if (!guide.active) return null;
  // The tutorial is of the first game of the slice, so it is offered where this page started that game.
  const canReplay = s.phase === "ready" && s.preset !== null;
  return (
    <section class="menu-section" data-testid="menu-help">
      <h3 class="menu-heading">{t("menu.help")}</h3>
      <label class="setting setting-menu" data-testid="menu-hints">
        <input type="checkbox" checked={guide.hintsOn} onChange={(event) => guide.setHintsOn((event.target as HTMLInputElement).checked)} />
        <span class="setting-text">
          <strong>{t("settings.hints")}</strong>
          <span>{t("settings.hints.help")}</span>
        </span>
      </label>
      <label class="setting setting-menu" data-testid="menu-night">
        <input type="checkbox" checked={play.flows.nightOn} onChange={(event) => play.flows.setNightOn((event.target as HTMLInputElement).checked)} />
        <span class="setting-text">
          <strong>{t("settings.night")}</strong>
          <span>{t("settings.night.help")}</span>
        </span>
      </label>
      <HintList play={play} lang={lang} onShow={onClose} />
      <div class="setting-choice" data-testid="menu-guidance">
        <strong>{t("settings.guidance")}</strong>
        <GuidanceSwitch play={play} />
        <span>{t("settings.guidance.help")}</span>
      </div>
      <div class="row">
        <button
          type="button"
          class="btn"
          data-testid="btn-tutorial"
          disabled={!canReplay}
          onClick={() => {
            onClose();
            guide.restartWithTutorial(() => client.firstGame());
          }}
        >
          {t("settings.tutorial.replay")}
        </button>
      </div>
      <p class="menu-note">{t("settings.tutorial.replay.help")}</p>
    </section>
  );
}

/** The speed of the day, as the menu has it. */
export interface MenuSpeed {
  value: SpeedChoice;
  onChange: (speed: SpeedChoice) => void;
  disabled: boolean;
}

export interface MenuProps {
  client: HostClient;
  play: Play;
  s: PageState;
  lang: Lang;
  theme: ThemeChoice;
  /** The frame on screen, for what the game has cost. */
  frame: ViewFrame | null;
  /** The speed of the day, which the menu has the switch for. */
  speed?: MenuSpeed | null;
  remembered: Remembered | null;
  open: boolean;
  onClose: () => void;
  /** Opens the gallery of recordings. Without it the drawer has no button for it. */
  onReplays?: () => void;
}

/** The drawer with everything that is about the game rather than in it: language, theme, saves, replay, model, cost, numbers. */
export function MenuDrawer({ client, play, s, lang, theme, frame, speed = null, remembered, open, onClose, onReplays }: MenuProps) {
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    if (drawer.current !== null) drawer.current.inert = !open;
  }, [open]);
  return (
    <>
      <div class="scrim" data-open={open} onClick={onClose} />
      <aside class="menu paper-page" id="game-menu" ref={drawer} data-testid="menu" data-open={open} aria-hidden={!open} aria-label={t("menu.title")}>
        <header class="menu-head">
          <h2>{t("menu.title")}</h2>
          <CloseCorner label={t("menu.close")} testid="menu-close" onClose={onClose} />
        </header>
        <div class="menu-body">
          <Look lang={lang} theme={theme} speed={speed} />
          <SoundSection />
          <Help play={play} client={client} s={s} lang={lang} onClose={onClose} />
          <Controls client={client} play={play} s={s} open={open} onReplays={onReplays} />
          <Provider client={client} initial={remembered} />
          <CostCard frame={frame} calls={s.calls} />
          <CallLog s={s} open={open} />
          <Details s={s} />
        </div>
      </aside>
    </>
  );
}
