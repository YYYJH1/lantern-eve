import { createReadStream, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { contentSecurityPolicy } from "../../src/csp.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".whl": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

export interface ServedRequest {
  path: string;
  status: number;
  bytes: number;
  contentType: string;
  /** The Content-Security-Policy header the response carried. */
  csp: string | undefined;
}

export interface StaticServer {
  origin: string;
  requests: ServedRequest[];
  /** The policy this server sends on every response. */
  csp: string;
  close(): Promise<void>;
}

/**
 * Serves a build directory the way a static host would, plus the policy as a header on every
 * response, which is what puts the worker under the policy too. `extraConnect` adds the origins of
 * the mock servers to connect-src.
 */
export async function startStaticServer(options: {
  root: string;
  extraConnect: readonly string[];
}): Promise<StaticServer> {
  const root = resolve(options.root);
  const csp = contentSecurityPolicy(options.extraConnect);
  const requests: ServedRequest[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(root, pathname));
    const record = (status: number, bytes: number, contentType: string): void => {
      requests.push({ path: pathname, status, bytes, contentType, csp });
    };
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      record(403, 0, "");
      return;
    }
    let size: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) throw new Error("not a file");
      size = stat.size;
    } catch {
      res.writeHead(404, { "Content-Security-Policy": csp }).end("not found");
      record(404, 9, "text/plain");
      return;
    }
    const contentType = TYPES[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": size,
      "Content-Security-Policy": csp,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    record(200, size, contentType);
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    csp,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
