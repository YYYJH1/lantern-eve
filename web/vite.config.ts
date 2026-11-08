import { defineConfig, type Plugin } from "vite";
import { contentSecurityPolicy } from "./src/csp.ts";

// The policy goes into the built page as a <meta> tag. The preview server (and the test server)
// also send it as a header, which is what covers the worker.
function cspMeta(): Plugin {
  return {
    name: "lantern-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy() },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode e2e` builds the same app plus the hooks the browser tests use.
  const e2e = mode === "e2e";
  return {
    base: "./",
    plugins: [cspMeta()],
    define: { __LANTERN_E2E__: JSON.stringify(e2e) },
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    build: {
      outDir: e2e ? "dist-e2e" : "dist",
      target: "es2022",
      emptyOutDir: true,
    },
    worker: { format: "es" },
    preview: { headers: { "Content-Security-Policy": contentSecurityPolicy() } },
  };
});
