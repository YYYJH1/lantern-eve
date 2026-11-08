import { defineConfig, devices } from "@playwright/test";

// Two projects. "unit" runs plain TypeScript in Node, with no browser. "chromium" runs the
// browser tests against the test build in dist-e2e (`npm run build:e2e`), served by the fixtures in
// test/support. The browser tests start their own servers on free ports, so nothing needs to be
// running beforehand.
export default defineConfig({
  testDir: "test",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  // A failed test leaves a screenshot in test-results, which CI uploads. There is no trace: it slows the page by a fifth, and these tests are about how the page keeps time.
  use: { trace: "off", screenshot: "only-on-failure", video: "off" },
  projects: [
    { name: "unit", testMatch: "**/unit/**/*.spec.ts" },
    {
      name: "chromium",
      testMatch: ["**/e2e/**/*.spec.ts", "live.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--enable-unsafe-swiftshader"] },
      },
    },
  ],
});
