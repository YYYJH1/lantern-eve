import { expect, test } from "../support/fixtures.ts";

// The synthesis in a real browser: every sound of the game rendered on an offline context. It checks what can be checked without ears:
// that each sound makes sound, that none of the numbers is wrong, that no sound clips, that the same seed makes the same sound, and that the
// layers of the ambience are in stereo.

test.use({ map: false });

interface Summary {
  id: string;
  length: number;
  peak: number;
  rmsDb: number;
  finite: boolean;
  differs: number;
  head: number[];
}

test.describe("the sounds rendered offline", () => {
  test("each makes sound, none is wrong or clips, and the layers of the ambience are in stereo", async ({ lantern }) => {
    await lantern.open("scenario=m0", { menu: false });
    const sources = { river: [[24, 14], [24, 15], [25, 15], [25, 16]], market: { x: 15, y: 17, w: 9, h: 7 } };
    const ids = ["layer-river", "layer-market", "layer-birds", "layer-insects", "layer-rain-light", "layer-rain-heavy", "layer-watchman", "festival-drums", "festival-tune", "festival-full", "festival-approach", "cue-paper", "cue-job-bridge", "cue-job-truth", "cue-job-peace", "cue-moment", "cue-ui-page", "cue-ui-seal", "cue-ui-ink", "mix-dawn-river", "mix-noon-market", "mix-dusk", "mix-night-watch", "mix-day-timelapse", "mix-rain-market"];
    const summaries: Summary[] = await lantern.page.evaluate(
      async ([list, src]) => {
        const out: Summary[] = [];
        for (const id of list as string[]) {
          const render = window.__lantern.renderSound;
          if (render === null) throw new Error("the page has no renderSound");
          const done = await render(id, src as never, { seconds: 6, sampleRate: 22050 });
          let finite = true;
          let differs = 0;
          for (let i = 0; i < done.left.length; i++) {
            const l = done.left[i] ?? 0;
            const r = done.right[i] ?? 0;
            if (!Number.isFinite(l) || !Number.isFinite(r)) finite = false;
            differs += Math.abs(l - r);
          }
          out.push({ id, length: done.left.length, peak: done.peak, rmsDb: done.rmsDb, finite, differs, head: Array.from(done.left.subarray(0, 8)) });
        }
        return out;
      },
      [ids, sources] as const,
    );
    expect(summaries.map((s) => s.id)).toEqual(ids);
    for (const s of summaries) {
      expect(s.finite, `${s.id} has a number that is not one`).toBe(true);
      expect(s.length, s.id).toBeGreaterThan(0);
      // Sound, and not too much of it: more than 55 dB under full scale for the quietest, never within 1 dB of full scale.
      expect(s.peak, `${s.id} is silent`).toBeGreaterThan(0.002);
      expect(s.peak, `${s.id} clips`).toBeLessThan(0.89);
    }
    // The ambience is in stereo: the two channels are not the same.
    for (const id of ["layer-river", "layer-market", "layer-rain-light", "layer-birds"]) {
      const s = summaries.find((x) => x.id === id);
      expect(s?.differs, `${id} is in mono`).toBeGreaterThan(1);
    }
  });

  test("the same seed makes the same sound, and another seed another", async ({ lantern }) => {
    await lantern.open("scenario=m0", { menu: false });
    const heads = await lantern.page.evaluate(async () => {
      const render = window.__lantern.renderSound;
      if (render === null) throw new Error("the page has no renderSound");
      const sources = { river: [], market: null };
      const take = async (seed: number): Promise<number[]> => Array.from((await render("layer-rain-light", sources, { seconds: 2, sampleRate: 22050, seed })).left.subarray(5000, 5016));
      return { a: await take(1), b: await take(1), c: await take(2) };
    });
    // The browser's own arithmetic differs in the last digits from one render to the next, so the same is the same to a ten thousandth.
    const apart = (x: number[], y: number[]): number => Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
    expect(apart(heads.a, heads.b)).toBeLessThan(1e-4);
    expect(apart(heads.a, heads.c)).toBeGreaterThan(1e-3);
  });
});
