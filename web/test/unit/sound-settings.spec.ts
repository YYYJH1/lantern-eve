import { expect, test } from "@playwright/test";
import { DEFAULT_SETTINGS, readSettings, readVolume, SoundPrefs, VOLUME_IDS } from "../../src/page/audio/settings.ts";
import { withStorage } from "../support/sound.ts";

// The switch and the three volumes: on at a middle volume until the viewer says otherwise, and remembered in the browser.

test.describe("the choices about sound", () => {
  test("are on, at a middle volume, for a viewer who has chosen nothing", () => {
    const { restore } = withStorage();
    try {
      expect(readSettings()).toEqual({ on: true, ambience: 0.7, music: 0.7, effects: 0.7 });
      expect(DEFAULT_SETTINGS.on).toBe(true);
      expect(VOLUME_IDS).toEqual(["ambience", "music", "effects"]);
    } finally {
      restore();
    }
  });

  test("write nothing until the viewer chooses", () => {
    const { store, restore } = withStorage();
    try {
      const prefs = new SoundPrefs();
      prefs.subscribe(() => undefined);
      expect(store.size).toBe(0);
    } finally {
      restore();
    }
  });

  test("the switch is remembered, and so is each volume, as a whole percent", () => {
    const { store, restore } = withStorage();
    try {
      const prefs = new SoundPrefs();
      prefs.setOn(false);
      prefs.setVolume("ambience", 0.35);
      prefs.setVolume("music", 0);
      prefs.setVolume("effects", 1);
      expect(Object.fromEntries(store)).toEqual({ "lantern.sound": "off", "lantern.sound.ambience": "35", "lantern.sound.music": "0", "lantern.sound.effects": "100" });
      // A page that opens afterwards has the same.
      const next = new SoundPrefs();
      expect(next.value).toEqual({ on: false, ambience: 0.35, music: 0, effects: 1 });
      next.setOn(true);
      expect(new SoundPrefs().value.on).toBe(true);
    } finally {
      restore();
    }
  });

  test("tell the listeners of a change, and not of a choice that changes nothing", () => {
    const { restore } = withStorage();
    try {
      const prefs = new SoundPrefs();
      let heard = 0;
      const stop = prefs.subscribe(() => heard++);
      prefs.setOn(true);
      prefs.setVolume("music", 0.7);
      expect(heard).toBe(0);
      prefs.setOn(false);
      prefs.setVolume("music", 0.3);
      expect(heard).toBe(2);
      stop();
      prefs.setVolume("music", 0.9);
      expect(heard).toBe(2);
    } finally {
      restore();
    }
  });

  test("keep a volume between nothing and full", () => {
    const { store, restore } = withStorage();
    try {
      const prefs = new SoundPrefs();
      prefs.setVolume("ambience", 3);
      expect(prefs.value.ambience).toBe(1);
      prefs.setVolume("ambience", -2);
      expect(prefs.value.ambience).toBe(0);
      expect(store.get("lantern.sound.ambience")).toBe("0");
    } finally {
      restore();
    }
  });

  test("ignore what is in storage that is not a choice", () => {
    expect(readVolume("40")).toBe(0.4);
    expect(readVolume("100")).toBe(1);
    expect(readVolume("0")).toBe(0);
    for (const bad of [null, "", "abc", "101", "-5", "4.5", "1e2", "loud"]) expect(readVolume(bad), String(bad)).toBeNull();
    const { store, restore } = withStorage();
    try {
      store.set("lantern.sound", "maybe");
      store.set("lantern.sound.music", "very loud");
      expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    } finally {
      restore();
    }
  });

  test("work for the visit in a browser that blocks storage", () => {
    const { restore } = withStorage({ blocked: true });
    try {
      expect(readSettings()).toEqual(DEFAULT_SETTINGS);
      const prefs = new SoundPrefs();
      prefs.setOn(false);
      prefs.setVolume("effects", 0.2);
      expect(prefs.value).toEqual({ on: false, ambience: 0.7, music: 0.7, effects: 0.2 });
    } finally {
      restore();
    }
  });
});
