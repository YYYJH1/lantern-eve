import { expect, test } from "@playwright/test";
import { SseParser } from "../../src/shared/sse.ts";

function parse(pieces: string[]): string[] {
  const parser = new SseParser();
  const events: string[] = [];
  for (const piece of pieces) parser.push(piece, (data) => events.push(data));
  parser.end((data) => events.push(data));
  return events;
}

test.describe("SseParser", () => {
  test("reads data events that end at a blank line", () => {
    expect(parse(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n'])).toEqual(['{"a":1}', '{"a":2}', "[DONE]"]);
  });

  test("gives the same events however the text is cut", () => {
    const text = 'data: {"a":1}\n\n: keep-alive\n\ndata: {"b":"é中"}\r\n\r\ndata: [DONE]\n\n';
    const whole = parse([text]);
    for (let cut = 1; cut < text.length; cut++) {
      expect(parse([text.slice(0, cut), text.slice(cut)])).toEqual(whole);
    }
    expect(parse([...text])).toEqual(whole);
    expect(whole).toEqual(['{"a":1}', '{"b":"é中"}', "[DONE]"]);
  });

  test("handles LF, CRLF and CR line endings, and a CRLF cut between the two", () => {
    expect(parse(["data: a\r\n\r\ndata: b\r\r"])).toEqual(["a", "b"]);
    expect(parse(["data: a\r", "\n\r", "\ndata: b\n\n"])).toEqual(["a", "b"]);
  });

  test("joins the data lines of one event with a newline and ignores other fields", () => {
    expect(parse(["event: message\nid: 7\nretry: 100\ndata: one\ndata: two\n\n"])).toEqual(["one\ntwo"]);
  });

  test("removes one leading space after the colon and no more", () => {
    expect(parse(["data:x\n\ndata:  y\n\n"])).toEqual(["x", " y"]);
  });

  test("ignores comment lines and events without data", () => {
    expect(parse([": ping\n\n\n\nevent: x\n\ndata: kept\n\n"])).toEqual(["kept"]);
  });

  test("delivers a last event that has no blank line after it", () => {
    expect(parse(["data: tail"])).toEqual(["tail"]);
    expect(parse(["data: tail\n"])).toEqual(["tail"]);
  });
});
