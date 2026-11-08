/**
 * The reasons that the core gives when it refuses an action of the manager, by action, as the docstrings
 * of core/lantern_core/world/bridge/player.py and the modules it names list them. A reason that is added
 * there has to be added here, and in the texts of the page.
 */
export const REASONS: Readonly<Record<string, readonly string[]>> = {
  move: ["talking", "busy", "unknown_place", "no_door", "outside", "blocked", "unreachable"],
  talk: ["talking", "busy", "unknown_npc", "far", "asleep"],
  leave: ["not_talking"],
  ask: ["not_talking", "unknown_topic"],
  ask_source: ["not_talking", "no_entry"],
  listen: ["talking", "busy", "nothing_to_hear"],
  look: ["talking", "busy", "unknown_target", "far", "nothing_here", "closed", "refused", "needs"],
  tell: ["not_talking", "no_entry", "no_sharpen", "bad_claim", "refused"],
  entrust: ["not_talking", "no_request", "no_entry", "cannot", "nothing_to_say", "said_already", "needs_nod", "unaware", "distrust", "too_late", "closed", "needs", "refused", "hard"],
  promise: ["not_talking", "empty", "bad_due", "no_pledge", "wrong_person", "kept_already", "lapsed"],
  speak: ["talking", "busy", "no_venue", "not_evening", "no_meeting", "empty_room", "no_evidence", "said_already", "heads_absent", "few_present", "no_entry", "not_shown", "overclaim", "no_witness"],
  rally: ["over", "already_open"],
};

/** A body that each action can be sent with, for a test that asks for a refusal. */
export const BODIES: Readonly<Record<string, Record<string, unknown>>> = {
  move: { x: 1, y: 1 },
  talk: { npc: "cha_laoban" },
  leave: {},
  ask: { topic: "t_rail" },
  ask_source: { entry: "n1" },
  listen: {},
  look: { at: "t_rail" },
  tell: { entry: "n1" },
  entrust: { kind: "lane" },
  promise: { op: "make", what: "stall", item: "front", due: 3 },
  speak: { kind: "meal" },
  rally: {},
};
