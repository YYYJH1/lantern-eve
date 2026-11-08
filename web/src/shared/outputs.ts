import type { StepOutputs } from "./protocol.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the JSON that Game.step returns and checks the parts of the contract the host relies on.
 * Everything else the core puts in the outputs passes through untouched.
 */
export function parseOutputs(raw: string): StepOutputs {
  const out: unknown = JSON.parse(raw);
  if (!isRecord(out)) throw new Error("step output is not an object");
  if (!Number.isSafeInteger(out.tick)) throw new Error("step output has no integer tick");
  if (typeof out.advanced !== "boolean") throw new Error("step output has no boolean advanced");
  if (!isRecord(out.frame) || !Array.isArray(out.frame.npcs)) {
    throw new Error("step output frame has no npcs list");
  }
  if (!Array.isArray(out.events)) throw new Error("step output has no events list");
  if (!Array.isArray(out.requests)) throw new Error("step output has no requests list");
  if (!Array.isArray(out.cancels)) throw new Error("step output has no cancels list");
  const clock = out.clock;
  if (!isRecord(clock) || typeof clock.paused !== "boolean") {
    throw new Error("step output has no clock.paused");
  }
  const rate = clock.rate;
  if (
    !Array.isArray(rate) ||
    rate.length !== 2 ||
    !Number.isSafeInteger(rate[0]) ||
    !Number.isSafeInteger(rate[1]) ||
    (rate[0] as number) < 0 ||
    (rate[1] as number) <= 0
  ) {
    throw new Error("step output has no valid clock.rate");
  }
  if (out.hash !== undefined && typeof out.hash !== "string") {
    throw new Error("step output hash is not a string");
  }
  for (const request of out.requests) {
    if (!isRecord(request) || typeof request.request_id !== "string") {
      throw new Error("a model request has no request_id");
    }
  }
  for (const id of out.cancels) {
    if (typeof id !== "string") throw new Error("a cancel is not a request id");
  }
  return out as unknown as StepOutputs;
}
