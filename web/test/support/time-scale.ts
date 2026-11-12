/**
 * How much longer than on a development machine a test may take. Every limit in the tests and in playwright.config.ts is written for the cores of
 * a development machine; the runners of CI have two slower ones. CI sets `LANTERN_TIME_SCALE` (see .github/workflows/ci.yml) to stretch all of the
 * limits by one factor: the limit a test has by default, the limit of an expectation, and each limit a test sets for itself with `test.setTimeout`
 * (test/support/fixtures.ts). A test that is only slow then ends, and a test that is stuck still ends, later. The factor is 1 where it is not set.
 * It stretches time limits and nothing a test waits for in the game, so a test that races the clock of the game or of the page has to be written
 * not to (see the section on tests in web/README.md).
 */
const asked = Number(process.env.LANTERN_TIME_SCALE ?? "1");

export const TIME_SCALE = Number.isFinite(asked) && asked >= 1 ? asked : 1;

/** A limit in milliseconds, stretched by the factor of the run. */
export const scaled = (ms: number): number => Math.round(ms * TIME_SCALE);
