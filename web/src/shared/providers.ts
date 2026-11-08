import type { ProviderId } from "./protocol.ts";

/** A model provider that speaks the OpenAI chat-completions protocol. */
export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Requests go to `${baseUrl}/chat/completions`. */
  baseUrl: string;
  /** Whether the provider needs a key. A key is never sent to one that does not. */
  needsKey: boolean;
  /** The model behind each tier of a request. */
  models: { cheap: string; strong: string };
  /** Fields added to every request body, mostly to keep the model from thinking. */
  extraBody: Record<string, unknown>;
}

// Model names change: check them in each provider's documentation before changing them here.
// DeepSeek: https://api-docs.deepseek.com/quick_start/pricing lists deepseek-flash and
// deepseek-v4-pro. Thinking is on by default there and is switched off with
// {"thinking": {"type": "disabled"}} (https://api-docs.deepseek.com/guides/thinking_mode).
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  bailian: {
    id: "bailian",
    label: "Alibaba Bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    models: { cheap: "qwen-flash", strong: "qwen-plus" },
    extraBody: { enable_thinking: false },
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    needsKey: true,
    models: { cheap: "deepseek-flash", strong: "deepseek-v4-pro" },
    extraBody: { thinking: { type: "disabled" } },
  },
  // Ollama: qwen3.5 thinks by default on the OpenAI-compatible
  // endpoint, so a small max_tokens is spent on thinking and the reply comes back empty, and
  // reasoning_effort "none" switches the thinking off.
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    models: { cheap: "qwen3.5:4b", strong: "qwen3.5:4b" },
    extraBody: { reasoning_effort: "none" },
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

export function modelFor(spec: ProviderSpec, tier: string, override?: string): string {
  if (override !== undefined && override !== "") return override;
  return tier === "strong" ? spec.models.strong : spec.models.cheap;
}
