import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DIST_E2E, OUT_DIR, REPO_DIR } from "./fixtures.ts";

export interface ServerHost {
  origin: string;
  /** Where the server writes its replays. */
  runsDir: string;
  /** Ends the server with SIGTERM, which makes it write its replays, and waits for it to exit. */
  stop(): Promise<number | null>;
  stderr(): string;
}

/**
 * Starts `lantern-eve play` on a free port, serving the test build, with a folder of its own for its replays, and returns where it
 * listens. `options` are those of `play`.
 */
export async function startServerHost(name: string, options: string[] = []): Promise<ServerHost> {
  const runsDir = path.join(OUT_DIR, "server-host", name);
  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  const child: ChildProcess = spawn(
    "uv",
    ["run", "--project", REPO_DIR, "--directory", REPO_DIR, "lantern-eve", "play", "--port", "0", "--web-dir", DIST_E2E, "--runs-dir", runsDir, ...options],
    // A group of its own, so that one signal reaches uv and the server it started.
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const origin = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`the server did not say where it listens in 90 s: ${stderr}`)), 90_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    void exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`the server exited with ${String(code)} before it listened: ${stderr}`));
    });
  });
  return {
    origin,
    runsDir,
    stderr: () => stderr,
    async stop() {
      if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
      return exited;
    },
  };
}
