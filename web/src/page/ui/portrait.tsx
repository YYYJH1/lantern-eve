import { useEffect, useRef, useState } from "preact/hooks";
import { getLang } from "../../i18n/index.ts";
import { drawPortrait } from "../portraits.ts";
import type { Person } from "../scene.ts";

export interface PortraitProps {
  person: Person;
  /** The side of the square, in pixels of the page; the style sheet may draw it smaller where the window has little room. */
  size: number;
  /** Whether the page has the sprites to cut a portrait from. A page without the map has none, and the seal stands for the person. */
  sprites: boolean;
}

/**
 * The portrait of a person: the head and shoulders of their figure on the map, or the seal of their surname in the colour of their family where
 * there is no figure to cut it from.
 */
export function Portrait({ person, size, sprites }: PortraitProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  useEffect(() => {
    let current = true;
    setDrawn(false);
    const target = canvas.current;
    if (!sprites || target === null) return;
    void drawPortrait(target, person.id).then(
      (ok) => {
        if (current) setDrawn(ok);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [person.id, sprites]);
  return (
    <span class="portrait" data-testid="portrait" data-person={person.id} data-drawn={drawn} data-family={person.family ?? ""} style={{ "--size": `${size}px` }} aria-hidden="true">
      {sprites ? <canvas ref={canvas} width={Math.round(size * ratio)} height={Math.round(size * ratio)} hidden={!drawn} /> : null}
      {drawn ? null : (
        <span class="surname-seal portrait-seal" data-family={person.family ?? ""} lang={getLang() === "zh" ? "zh-CN" : "en"}>
          {person.token[getLang()]}
        </span>
      )}
    </span>
  );
}
