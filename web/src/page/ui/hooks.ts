import { useEffect, useMemo, useState } from "preact/hooks";
import { getLang, type Lang, subscribeLang } from "../../i18n/index.ts";
import type { HostClient, PageState } from "../client.ts";
import { getTheme, subscribeTheme, type ThemeChoice } from "../prefs.ts";
import { parseScene, type Scene } from "../scene.ts";

/** Re-renders the component whenever the host client reports a change, at most once a frame. */
export function useClientState(client: HostClient): PageState {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let queued = false;
    const unsubscribe = client.subscribe(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setVersion(client.version);
      });
    });
    setVersion(client.version);
    return unsubscribe;
  }, [client]);
  return client.state;
}

export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>(getLang());
  useEffect(() => subscribeLang(() => setLang(getLang())), []);
  return lang;
}

export function useTheme(): ThemeChoice {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme());
  useEffect(() => subscribeTheme(() => setTheme(getTheme())), []);
  return theme;
}

/** The size of the window, again whenever it is resized. */
export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const sync = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", sync);
    sync();
    return () => window.removeEventListener("resize", sync);
  }, []);
  return size;
}

/** The scene of the running game, read once for each time it changes. */
export function useScene(state: PageState): Scene | null {
  return useMemo(() => (state.scene === null ? null : parseScene(state.scene)), [state.scene, state.sceneVersion]);
}
