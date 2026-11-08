/**
 * The Content Security Policy of the page.
 *
 * The page loads no third-party script or file. Scripts are the page's own modules plus
 * WebAssembly compilation (Pyodide). The only network origins besides the page itself are the
 * model providers the player can choose. The same policy goes into a <meta> tag at build time and
 * into the HTTP headers of `vite preview` (vite.config.ts), of `lantern-eve play` and of the test
 * servers. The dev server sends none. A <meta> policy covers the document only: a worker gets its
 * policy from the headers of its own script response, so a host that can set headers should send
 * this string on every response.
 */
export const PROVIDER_ORIGINS = [
  "https://dashscope.aliyuncs.com",
  "https://api.deepseek.com",
  "http://localhost:11434",
] as const;

export function contentSecurityPolicy(extraConnect: readonly string[] = []): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${[...PROVIDER_ORIGINS, ...extraConnect].join(" ")}`,
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}
