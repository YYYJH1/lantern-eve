import { expect, test } from "../support/fixtures.ts";
import { advance, CASES, type Case, endingOf, loadFinished, MOMENTS, nightFrame, openNight } from "../support/festival.ts";
import * as fake from "../support/slice.ts";
import { steady } from "../support/steady.ts";

// The moments of the game at the foot of the ending page: a picture of the map taken while the show of each moment plays, in the order they happened, each
// with its words and where and when it was; kept with the save of the game if the save has room for it; and a small card of paper with the same words for a
// game that is loaded without the pictures. The shows play on a clock that the test moves by hand.
test.use({ map: true });

const TOWN = `${fake.TOWN}&director=on&showclock=manual`;
const FULL = CASES[0] as Case;

const happened = (m: Record<string, unknown>): Record<string, unknown> => {
  const { kind, ...rest } = m;
  return { kind: "moment", moment: kind, ...rest };
};

/** A frame of the game with the key of the moments, so that the page knows the game is watched, held on the morning of the first day. */
async function opened(lantern: Parameters<Parameters<typeof test>[2]>[0]["lantern"]): Promise<void> {
  await fake.openFirstDay(lantern, { notebook: [], commitments: [], moments: [], moment_hold: [] }, TOWN);
  await lantern.page.waitForFunction(() => window.__lantern.play.director.port !== null);
  await fake.recordSent(lantern.page);
}

/** What the album of the page has, by kind. */
const album = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const a = window.__lantern.play.album;
    return { size: a.size, echo: a.get("echo"), together_work: a.get("together_work"), both_banks: a.get("both_banks") };
  });

test.describe("the picture of a moment", () => {
  test("is taken from the map while its show plays, once the camera is there, and is a small JPEG that a save has room for", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const [banks] = [MOMENTS[1] as Record<string, unknown>];
    await fake.feedFrame(page, { moments: [banks], moment_hold: ["both_banks"] }, [happened(banks)]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "both_banks");
    // not yet: the camera is still on its way
    await advance(page, 400);
    expect((await album(page)).size).toBe(0);
    await advance(page, 1000);
    const taken = await album(page);
    expect(taken.size).toBe(1);
    expect(taken.both_banks).toMatch(/^data:image\/jpeg;base64,/);
    expect((taken.both_banks as string).length).toBeLessThanOrEqual(40_000);
    expect((taken.both_banks as string).length).toBeGreaterThan(1500);
    // the show goes on to its end and the picture is kept
    await advance(page, 3000);
    await expect(page.getByTestId("director")).toHaveCount(0);
    expect((await album(page)).both_banks).toBe(taken.both_banks);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is a picture of the map and not of the page: it is of the middle of the town where the moment happened, wider than tall", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const echo = MOMENTS[0] as Record<string, unknown>;
    await fake.feedFrame(page, { moments: [echo], moment_hold: ["echo"] }, [happened(echo)]);
    await advance(page, 1600);
    const url = (await album(page)).echo as string;
    const size = await page.evaluate(
      (src) =>
        new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => reject(new Error("the picture does not load"));
          img.src = src;
        }),
      url,
    );
    expect(size).toEqual({ w: 288, h: 180 });
  });

  test("is of what the player sees at the moment, the middle of the map where the camera is: the pattern of its middle is the pattern of the middle of the screen, and not of the other moment", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await opened(lantern);
    const seen: Array<{ picture: string; screen: string }> = [];
    for (const m of [MOMENTS[0], MOMENTS[1]] as Array<Record<string, unknown>>) {
      const kind = m.kind as string;
      await fake.feedFrame(page, { moments: [m], moment_hold: [kind] }, [happened(m)]);
      await advance(page, 1700);
      const picture = (await album(page))[kind as "echo" | "both_banks"] as string;
      expect(picture, kind).toMatch(/^data:image\/jpeg/);
      await steady(page);
      seen.push({ picture, screen: `data:image/png;base64,${(await page.screenshot()).toString("base64")}` });
      await page.getByTestId("director-veil").click();
      await expect(page.getByTestId("director")).toHaveCount(0);
    }
    // The picture is the middle 997 by 623 of the screen (from 141 across and 68 down). The part of it that nothing of the page is laid over, which is the screen from 340 to 939
    // across and from 340 to 540 down, is its box from 0.2 to 0.8 across and from 0.437 to 0.758 down. Both are cut down to a grid of 30 by 10 grey values.
    const r = await page.evaluate(async (pairs) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("an image does not load"));
          img.src = src;
        });
      const grid = async (src: string, box: readonly [number, number, number, number]): Promise<number[]> => {
        const img = await load(src);
        const canvas = document.createElement("canvas");
        canvas.width = 30;
        canvas.height = 10;
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.imageSmoothingQuality = "high";
        context.drawImage(img, box[0] * img.naturalWidth, box[1] * img.naturalHeight, (box[2] - box[0]) * img.naturalWidth, (box[3] - box[1]) * img.naturalHeight, 0, 0, 30, 10);
        const data = context.getImageData(0, 0, 30, 10).data;
        const out: number[] = [];
        for (let i = 0; i < data.length; i += 4) out.push(0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number));
        return out;
      };
      const pearson = (a: number[], b: number[]): number => {
        const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
        const ma = mean(a);
        const mb = mean(b);
        let ab = 0;
        let aa = 0;
        let bb = 0;
        a.forEach((v, i) => {
          ab += (v - ma) * ((b[i] as number) - mb);
          aa += (v - ma) ** 2;
          bb += ((b[i] as number) - mb) ** 2;
        });
        return ab / Math.sqrt(aa * bb);
      };
      const pictures = await Promise.all(pairs.map((pair) => grid(pair.picture, [0.2, 272 / 623, 0.8, 472 / 623])));
      const screens = await Promise.all(pairs.map((pair) => grid(pair.screen, [340 / 1280, 340 / 760, 939 / 1280, 540 / 760])));
      return { same: pictures.map((g, i) => pearson(g, screens[i] as number[])), other: pictures.map((g, i) => pearson(g, screens[1 - i] as number[])) };
    }, seen);
    for (const i of [0, 1]) {
      expect(r.same[i], `the picture of moment ${i} against its own screen: ${JSON.stringify(r)}`).toBeGreaterThan(0.6);
      expect(r.other[i], `the picture of moment ${i} against the screen of the other: ${JSON.stringify(r)}`).toBeLessThan((r.same[i] as number) - 0.2);
    }
  });

  test("is not taken twice for a kind, nor where the show is let go before the camera is there", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const echo = MOMENTS[0] as Record<string, unknown>;
    await fake.feedFrame(page, { moments: [echo], moment_hold: ["echo"] }, [happened(echo)]);
    await advance(page, 200);
    await page.getByTestId("director-veil").click();
    await expect(page.getByTestId("director")).toHaveCount(0);
    expect((await album(page)).size).toBe(0);
  });
});

test.describe("the row at the foot of the ending page", () => {
  /** The game comes to its end in a page that has played its three moments, with a picture taken for each. */
  async function playedThree(lantern: Parameters<Parameters<typeof test>[2]>[0]["lantern"]): Promise<void> {
    const page = lantern.page;
    await opened(lantern);
    for (const m of MOMENTS as Array<Record<string, unknown>>) {
      await fake.feedFrame(page, { moments: MOMENTS.filter((x) => x.tick <= (m.tick as number)), moment_hold: [m.kind] }, [happened(m)]);
      await advance(page, 1700);
      await page.getByTestId("director-veil").click();
      await expect(page.getByTestId("director")).toHaveCount(0);
    }
    expect((await album(page)).size).toBe(3);
  }

  const WORDS = {
    en: {
      title: "Moments of this game",
      words: ["What you said came back to you from Shopkeeper Zhou.", "Lanterns hang on both banks.", "People of the Li and Zhou families carry materials together for the first time."],
      // tick 812 is 12:46 of the first day, 3200 is 15:25 of the second, 4490 is 08:55 of the third
      where: ["Zhou Family House, Day 1 12:46", "Stone Bridge, Day 2 15:25", "Stone Bridge, Day 3 08:55"],
      alt: "The moment: What you said came back to you from Shopkeeper Zhou.",
    },
    zh: {
      title: "这一局的几个时刻",
      words: ["你说过的话，又从周掌柜那里传回来了。", "两岸都挂起了灯。", "李家和周家的人，第一次一起搬料。"],
      where: ["周家宅，第一天 12:46", "石桥，第二天 15:25", "石桥，第三天 08:55"],
      alt: "这一刻：你说过的话，又从周掌柜那里传回来了。",
    },
  } as const;

  for (const lang of ["en", "zh"] as const) {
    test(`has one small picture for each moment, in the order they happened, each with its words and where and when it was, in ${lang === "en" ? "English" : "Chinese"}`, async ({ lantern }) => {
      test.setTimeout(150_000);
      const page = lantern.page;
      await playedThree(lantern);
      await lantern.setLang(lang);
      const ending = endingOf(FULL);
      await fake.feedFrame(page, nightFrame(FULL, { ending, moments: MOMENTS }), [ending]);
      await expect(page.getByTestId("ending")).toBeVisible();
      const row = page.getByTestId("ending-moments");
      await expect(row).toBeVisible();
      await expect(row.getByRole("heading")).toHaveText(WORDS[lang].title);
      const items = row.getByTestId("moment");
      await expect(items).toHaveCount(3);
      await expect(items.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).resolves.toEqual(["echo", "both_banks", "together_work"]);
      await expect(items.evaluateAll((els) => els.map((el) => el.getAttribute("data-picture")))).resolves.toEqual(["true", "true", "true"]);
      await expect(row.getByTestId("moment-picture")).toHaveCount(3);
      await expect(row.getByTestId("moment-card")).toHaveCount(0);
      await expect(row.getByTestId("moment-words")).toHaveText([...WORDS[lang].words]);
      await expect(row.getByTestId("moment-where")).toHaveText([...WORDS[lang].where]);
      // each picture is the one that was taken for that moment
      const sources = await row.getByTestId("moment-picture").evaluateAll((els) => els.map((el) => el.getAttribute("src")));
      const kept = await album(page);
      expect(sources).toEqual([kept.echo, kept.both_banks, kept.together_work]);
      await expect(row.getByTestId("moment-picture").first()).toHaveAttribute("alt", WORDS[lang].alt);
      // the row is at the foot of the page, above its buttons
      const box = await row.boundingBox();
      const foot = await page.getByTestId("ending-new").boundingBox();
      if (box === null || foot === null) throw new Error("no box");
      expect(box.y).toBeLessThan(foot.y);
      expect(lantern.pageErrors).toEqual([]);
    });
  }

  test("has a small paper card with the place, the time and the words for a moment the page has no picture of", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const ending = endingOf(FULL);
    await fake.feedFrame(page, nightFrame(FULL, { ending, moments: MOMENTS }), [ending]);
    const row = page.getByTestId("ending-moments");
    await expect(row.getByTestId("moment")).toHaveCount(3);
    await expect(row.getByTestId("moment-card")).toHaveCount(3);
    await expect(row.getByTestId("moment-picture")).toHaveCount(0);
    await expect(row.getByTestId("moment").first()).toHaveAttribute("data-picture", "false");
    const card = row.getByTestId("moment-card").nth(1);
    await expect(card.getByTestId("moment-words")).toHaveText("Lanterns hang on both banks.");
    await expect(card.getByTestId("moment-where")).toHaveText("Stone Bridge, Day 2 15:25");
    // it is a slip of paper of the same size as a picture
    const size = await card.boundingBox();
    expect(size?.width).toBe(216);
  });

  test("is not there for a game that had no moments", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const ending = endingOf(FULL);
    await fake.feedFrame(page, nightFrame(FULL, { ending }), [ending]);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("ending-moments")).toHaveCount(0);
  });
});

test.describe("a save", () => {
  test("keeps the pictures with the notes of the page, and a game that is loaded from it shows them again", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await opened(lantern);
    const echo = MOMENTS[0] as Record<string, unknown>;
    const banks = MOMENTS[1] as Record<string, unknown>;
    await fake.feedFrame(page, { moments: [echo], moment_hold: ["echo"] }, [happened(echo)]);
    await advance(page, 1700);
    await page.getByTestId("director-veil").click();
    await fake.feedFrame(page, { moments: [echo, banks], moment_hold: ["both_banks"] }, [happened(banks)]);
    await advance(page, 1700);
    await page.getByTestId("director-veil").click();
    const taken = await album(page);
    expect(taken.size).toBe(2);

    // The page hands the host its notes with the save: the pictures are in them, under the size a save has room for.
    const notes = await page.evaluate(() => window.__lantern.client.pageNotes?.() ?? null);
    expect(notes).toEqual({ moments: { pictures: { echo: taken.echo, both_banks: taken.both_banks } } });
    expect(JSON.stringify(notes).length).toBeLessThanOrEqual(163_840);
    const meta = await page.evaluate(() => window.__lantern.client.save("with pictures"));
    expect(meta.name).toBe("with pictures");

    // A game that is loaded from it has the notes back and the pictures in the album; a new game has none.
    await page.evaluate((m) => window.__lantern.client.load(m.id), meta);
    await expect.poll(async () => (await album(page)).size).toBe(2);
    const loaded = await album(page);
    expect(loaded.echo).toBe(taken.echo);
    expect(loaded.both_banks).toBe(taken.both_banks);
    expect(loaded.together_work).toBeNull();
    await page.evaluate(() => window.__lantern.client.newGame(null));
    await expect.poll(async () => (await album(page)).size).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("brings the pictures to the ending page of a finished game that is loaded, a card for the moment that has none", async ({ lantern }) => {
    const page = lantern.page;
    await openNight(lantern, FULL, "en", "dark");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
    // the page has taken no pictures; the save that is loaded brings two
    const jpeg = (n: number): string => `data:image/jpeg;base64,${"A".repeat(n)}`;
    const notes = { moments: { pictures: { echo: jpeg(900), together_work: jpeg(1200) } } };
    await loadFinished(page, FULL, { moments: MOMENTS }, notes);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await page.keyboard.press("Escape");
    const row = page.getByTestId("ending-moments");
    await expect(row.getByTestId("moment")).toHaveCount(3);
    await expect(row.getByTestId("moment").evaluateAll((els) => els.map((el) => el.getAttribute("data-picture")))).resolves.toEqual(["true", "false", "true"]);
    await expect(row.getByTestId("moment-picture")).toHaveCount(2);
    await expect(row.getByTestId("moment-card")).toHaveCount(1);
  });
});
