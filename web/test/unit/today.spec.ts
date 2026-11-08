import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { parseScene } from "../../src/page/scene.ts";
import { readSlice } from "../../src/page/slice.ts";
import { todayLine, todayTask } from "../../src/page/ui/today.ts";
import * as fake from "../support/slice.ts";

const SCENE = parseScene({
  scenario: "bridge",
  name: { zh: "澄溪镇", en: "Chengxi Town" },
  width: 40,
  height: 20,
  layers: { terrain: { rows: [], legend: [] }, buildings: [], barriers: [] },
  places: [
    { id: "p_li_house", kind: "house", indoor: true, rect: [3, 5, 4, 3], door: [4, 8], stands: [], cells: [], zh: "李家宅", en: "Li Family House" },
    { id: "p_teahouse", kind: "teahouse", indoor: true, rect: [30, 5, 4, 3], door: [31, 8], stands: [], cells: [], zh: "茶馆", en: "Teahouse" },
  ],
  cast: [],
});

const sliceOf = (extras: Record<string, unknown>) => readSlice({ npcs: [], time: { day: 2, hour: 7, minute: 0, phase: "day" }, weather: "clear", hud: {}, ...extras });

test.afterEach(() => setLang("en"));

test.describe("the line of the morning that says what to do today", () => {
  test("names the task that is followed, with its time and its place, in both languages", () => {
    const slice = sliceOf(fake.laterTasks("t_bamboo_more"));
    expect(todayTask(slice)?.id).toBe("t_bamboo_more");
    setLang("en");
    expect(todayLine(slice, SCENE, "en")).toBe("Today: Ask Li Da for another batch of bamboo, Li Family House, Day 2 08:00 to 17:00");
    setLang("zh");
    expect(todayLine(slice, SCENE, "zh")).toBe("今天：再请李大送一批竹料，李家宅，第二日 辰时 08:00 到 17:00");
  });

  test("names the most urgent task that is open when none is followed, or the one that is followed has been done", () => {
    setLang("en");
    const none = sliceOf(fake.laterTasks(null));
    expect(todayTask(none)?.id).toBe("t_bamboo_more");
    const done = sliceOf(fake.laterTasks("t_bamboo_more", { t_bamboo_more: "done" }));
    expect(todayTask(done)?.id).toBe("t_timber");
    const settled = sliceOf(fake.laterTasks("t_bamboo_more", { t_bamboo_more: "stale", t_timber: "done" }));
    expect(todayTask(settled)?.id).toBe("t_lend");
    // A task that is blocked is still to be done.
    expect(todayTask(sliceOf(fake.laterTasks(null, { t_bamboo_more: "blocked" })))?.id).toBe("t_bamboo_more");
  });

  test("leaves the time and the place out for a task that has none, and the line out when there is no task", () => {
    setLang("en");
    expect(todayLine(sliceOf(fake.laterTasks("t_timber")), SCENE, "en")).toBe("Today: Ask Shopkeeper Zhou for the timber");
    expect(todayLine(sliceOf(fake.laterTasks("t_bamboo_more")), null, "en")).toBe("Today: Ask Li Da for another batch of bamboo, Day 2 08:00 to 17:00");
    const every = Object.fromEntries((fake.laterTasks().tasks as Array<{ id: string }>).map((task) => [task.id, "done"]));
    expect(todayLine(sliceOf(fake.laterTasks(null, every)), SCENE, "en")).toBeNull();
    expect(todayLine(sliceOf({}), SCENE, "en")).toBeNull();
    expect(todayTask(sliceOf({ tasks: [] }))).toBeNull();
  });
});
