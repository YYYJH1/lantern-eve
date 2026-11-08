import type { PageState } from "./client.ts";

export type WorldWord = "starting" | "running" | "paused" | "failed" | "held";

/** Who stopped a world that stands still: the player (the pause button), a hidden tab, the page (a sheet of its own is up), or the core, which holds the clock itself. */
export type Stopper = "player" | "tab" | "page" | "core";

/** What is needed to tell who stopped the world: whether it stands still, and the reasons the host has given for it (`stats.reasons`). */
export interface Standing {
  readonly paused: boolean;
  readonly stats?: { readonly reasons: readonly string[] } | null;
}

/**
 * Who stopped the world, or null while it runs. The host names three reasons of its own, `user` (the player pressed
 * pause), `hidden` (the tab is hidden) and `page` (the page holds the world for the notebook or a card of the help). A
 * world that stands still for none of them is held by the core, which stops the clock itself while the player talks.
 * Until the host has said why, a world that stands still is taken to be the player's pause. This is the one place that
 * tells the core's hold and the page's from the player's pause: the word for the bar, the pause button and the hold the
 * page puts on the world (`hold.ts`) all ask it.
 */
export function stoppedBy(s: Standing): Stopper | null {
  if (!s.paused) return null;
  const reasons = s.stats?.reasons;
  if (reasons === undefined || reasons.includes("user")) return "player";
  if (reasons.includes("hidden")) return "tab";
  return reasons.includes("page") ? "page" : "core";
}

/**
 * The word for what the world is doing, for the bar at the top. A world that stands still is `paused` when the
 * player or a hidden tab paused it, and `held` when nobody did: the core stops the clock itself while the player
 * talks, and the player did not press anything. The page's own hold on top of that (the notebook is open in a talk)
 * does not change the word: time is still held. Outside a talk the page's hold is a pause. The pause button follows
 * the word: it offers a pause for `held`, and a resume only for `paused`.
 */
export function worldWord(s: Pick<PageState, "phase" | "paused" | "stats">, talking: boolean): WorldWord {
  if (s.phase === "failed") return "failed";
  if (s.phase === "boot") return "starting";
  const by = stoppedBy(s);
  if (by === null) return "running";
  return (by === "core" || by === "page") && talking ? "held" : "paused";
}
