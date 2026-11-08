import type { LanternHandle } from "../../src/page/e2e.ts";

declare global {
  interface Window {
    __lantern: LanternHandle;
  }
}
