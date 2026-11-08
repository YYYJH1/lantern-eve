import type { ComponentChildren } from "preact";

/**
 * A text with `{name}` in it, where each name is a piece of the page and not a string: the words stay in the table (and in both languages) and the
 * pieces, which carry a test id or a class of their own, are put in their places.
 */
export function fill(template: string, parts: Readonly<Record<string, ComponentChildren>>): ComponentChildren[] {
  return template.split(/(\{\w+\})/).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name === undefined ? piece : (parts[name] ?? piece);
  });
}
