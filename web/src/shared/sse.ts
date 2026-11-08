/**
 * A parser for the text/event-stream format, reduced to what a chat-completions stream uses:
 * lines that start with `data:`, events that end at a blank line, `:` comment lines that carry
 * keep-alives, and any line ending (LF, CRLF or CR). Text can arrive cut at any byte boundary.
 */
export class SseParser {
  private buffer = "";
  private data: string[] = [];

  /** Feed the next piece of decoded text. `onEvent` gets the data of each complete event. */
  push(text: string, onEvent: (data: string) => void): void {
    this.buffer += text;
    let start = 0;
    for (;;) {
      let i = start;
      while (i < this.buffer.length) {
        const c = this.buffer.charCodeAt(i);
        if (c === 10 || c === 13) break;
        i++;
      }
      if (i >= this.buffer.length) break;
      let next = i + 1;
      if (this.buffer.charCodeAt(i) === 13) {
        // A CR at the very end may be the first half of a CRLF. Wait for the next piece.
        if (i + 1 >= this.buffer.length) break;
        if (this.buffer.charCodeAt(i + 1) === 10) next = i + 2;
      }
      this.line(this.buffer.slice(start, i), onEvent);
      start = next;
    }
    this.buffer = this.buffer.slice(start);
  }

  /** The stream ended. A last line and a last event without their blank line still count. */
  end(onEvent: (data: string) => void): void {
    if (this.buffer.length > 0) {
      const rest = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = "";
      this.line(rest, onEvent);
    }
    this.dispatch(onEvent);
  }

  private line(line: string, onEvent: (data: string) => void): void {
    if (line === "") {
      this.dispatch(onEvent);
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.data.push(value);
  }

  private dispatch(onEvent: (data: string) => void): void {
    if (this.data.length === 0) return;
    const data = this.data.join("\n");
    this.data = [];
    onEvent(data);
  }
}
