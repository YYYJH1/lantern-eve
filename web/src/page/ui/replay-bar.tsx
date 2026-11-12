import { useEffect, useState } from "preact/hooks";
import { getLang, t } from "../../i18n/index.ts";
import type { HostClient, PageState } from "../client.ts";
import { tickText } from "./format.ts";
import { PauseIcon, PlayIcon, StartIcon } from "./icons.tsx";

/** The speeds the bar offers, times the pace of the recorded game. */
export const SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;

/** The controls of a recording: to the start, play and pause, a bar to jump to any tick, and the speed. */
export function ReplayBar({ client, s }: { client: HostClient; s: PageState }) {
  const status = s.replay;
  const end = status?.endTick ?? 0;
  const ready = status !== null && status.phase === "ready" && end >= 1;
  const busy = status?.busy === true;
  // Where the bar stands while the viewer drags it, and after they let go until the world is there.
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    if (target !== null && (s.simTick === target || status?.phase === "failed")) setTarget(null);
  }, [target, s.simTick, status?.phase]);

  const tick = Math.min(Math.max(1, target ?? s.simTick), Math.max(1, end));
  const playing = status?.playing === true;
  const label = playing ? t("replay.pause") : status?.ended === true ? t("replay.again") : t("replay.play");
  const where = t("replay.tick", { when: tickText(getLang(), tick), end: tickText(getLang(), end) });
  return (
    <section class="replay-bar" data-testid="replay-bar" data-phase={status?.phase ?? "idle"} data-playing={playing} data-busy={busy} aria-label={t("gallery.title")}>
      <div class="replay-buttons">
        <button type="button" class="btn" data-testid="replay-start" disabled={!ready || busy} title={t("replay.start")} aria-label={t("replay.start")} onClick={() => client.seek(1)}>
          <StartIcon />
        </button>
        <button type="button" class="btn btn-primary" data-testid="replay-play" disabled={!ready || busy} aria-label={label} onClick={() => (playing ? client.pause() : client.resume())}>
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{label}</span>
        </button>
      </div>
      <input
        type="range"
        class="replay-seek"
        data-testid="replay-seek"
        min={1}
        max={Math.max(1, end)}
        step={1}
        value={tick}
        disabled={!ready}
        aria-label={t("replay.seek")}
        aria-valuetext={where}
        onInput={(event) => setTarget(Number((event.target as HTMLInputElement).value))}
        onChange={(event) => {
          const value = Number((event.target as HTMLInputElement).value);
          setTarget(value);
          client.seek(value);
        }}
      />
      <div class="replay-readout" aria-live="off">
        <span data-testid="replay-tick" data-tick={tick} data-end={end}>
          {where}
        </span>
        {busy ? (
          <span class="replay-busy" data-testid="replay-busy">
            {t("replay.busy", { percent: Math.round((status?.progress ?? 0) * 100) })}
          </span>
        ) : status?.ended === true ? (
          <span class="replay-busy" data-testid="replay-ended">
            {t("replay.ended")}
          </span>
        ) : null}
      </div>
      <label class="replay-speed">
        <span>{t("replay.speed")}</span>
        <select data-testid="replay-speed" value={status?.speed ?? 1} disabled={!ready} onChange={(event) => client.setSpeed(Number((event.target as HTMLSelectElement).value))}>
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {`×${speed}`}
            </option>
          ))}
        </select>
      </label>
      {status?.error == null ? null : (
        <p class="replay-error" data-testid="replay-error" role="alert">
          {t("replay.error", { message: status.error.message })}
        </p>
      )}
    </section>
  );
}
