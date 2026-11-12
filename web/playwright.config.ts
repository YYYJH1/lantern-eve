import { defineConfig, devices } from "@playwright/test";
import { scaled } from "./test/support/time-scale.ts";

// Two projects. "unit" runs plain TypeScript in Node, with no browser. "chromium" runs the
// browser tests against the test build in dist-e2e (`npm run build:e2e`), served by the fixtures in
// test/support. The browser tests start their own servers on free ports, so nothing needs to be
// running beforehand. The limits are those of a development machine, stretched by LANTERN_TIME_SCALE
// (test/support/time-scale.ts), which CI sets for its slower runners.
export default defineConfig({
  testDir: "test",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: scaled(90_000),
  expect: { timeout: scaled(15_000) },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  // A failed test leaves a screenshot in test-results, which CI uploads. There is no trace: it slows the page by a fifth, and these tests are about how the page keeps time.
  // A click that has to wait for a button to be enabled gives up after a minute and says so, and does not wait for the whole limit of its test.
  use: { trace: "off", screenshot: "only-on-failure", video: "off", actionTimeout: scaled(60_000) },
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
