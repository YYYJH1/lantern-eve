"""The built web client from the same port, under the policy the preview server sends."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import aiohttp
import pytest
from host_helpers import CSP, Client, make_web_dir, serving

from lantern_eve import server as server_module
from lantern_eve.server import HostOptions, ServerHost
from lantern_eve.static import WebDirError, content_type, load_policy, resolve

ROOT = Path(__file__).resolve().parents[2]


def run(coro):
    return asyncio.run(coro)


async def get(host, path: str, method: str = "GET", **kwargs):
    url = f"http://127.0.0.1:{host.port}{path}"
    async with aiohttp.ClientSession() as http, http.request(method, url, **kwargs) as reply:
        return reply.status, dict(reply.headers), await reply.read()


async def raw_get(host, target: str) -> tuple[int, bytes]:
    """A GET with the request target exactly as given: a client library would tidy it first."""
    reader, writer = await asyncio.open_connection("127.0.0.1", host.port)
    head = f"GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{host.port}\r\nConnection: close\r\n\r\n"
    writer.write(head.encode())
    await writer.drain()
    data = await reader.read()
    writer.close()
    head, _, body = data.partition(b"\r\n\r\n")
    return int(head.split(b" ", 2)[1]), body


def test_the_page_comes_with_the_policy_the_build_put_in_it(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            assert host.csp == CSP
            for path in ("/", "/index.html", "/assets/app.js", "/assets/core.wasm", "/nope"):
                status, headers, _ = await get(host, path)
                assert headers["Content-Security-Policy"] == CSP, path
                assert headers["X-Content-Type-Options"] == "nosniff", path
                assert status == (404 if path == "/nope" else 200)

    run(main())


def test_files_have_the_types_a_module_script_and_a_wasm_module_need(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            types = {}
            for path in (
                "/",
                "/assets/app.js",
                "/assets/app.css",
                "/assets/core.wasm",
                "/assets/data.json",
            ):
                status, headers, body = await get(host, path)
                types[path] = headers["Content-Type"]
                assert status == 200 and headers["Cache-Control"] == "no-cache"
                served = (tmp_path / "web") / (path.lstrip("/") or "index.html")
                assert body == served.read_bytes()
            assert types == {
                "/": "text/html; charset=utf-8",
                "/assets/app.js": "text/javascript; charset=utf-8",
                "/assets/app.css": "text/css; charset=utf-8",
                "/assets/core.wasm": "application/wasm",
                "/assets/data.json": "application/json; charset=utf-8",
            }

    run(main())


def test_head_is_answered_and_other_methods_are_not(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            status, headers, body = await get(host, "/assets/app.js", method="HEAD")
            assert status == 200 and body == b"" and int(headers["Content-Length"]) > 0
            assert headers["Content-Security-Policy"] == CSP
            for method in ("POST", "PUT", "DELETE"):
                assert (await get(host, "/", method=method))[0] == 405

    run(main())


def test_nothing_outside_the_web_dir_is_served(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("do not serve", encoding="utf-8")

    async def main():
        async with serving(tmp_path) as host:
            for target in (
                "/../secret.txt",
                "/%2e%2e/secret.txt",
                "/assets/../../secret.txt",
                "/assets/..%2f..%2fsecret.txt",
                "/%2e%2e%2fsecret.txt",
                "//secret.txt",
                "/assets/%00.js",
                "/assets/..%5c..%5csecret.txt",
                "/./../secret.txt",
            ):
                status, body = await raw_get(host, target)
                assert b"do not serve" not in body, target
                assert status in (400, 403, 404), (target, status)

    run(main())


def test_a_link_out_of_the_web_dir_is_not_followed(tmp_path):
    web = make_web_dir(tmp_path / "web")
    secret = tmp_path / "secret.txt"
    secret.write_text("do not serve", encoding="utf-8")
    (web / "assets" / "link.txt").symlink_to(secret)
    assert resolve(web, "/assets/link.txt") is None
    assert resolve(web, "/assets/app.js") == (web / "assets" / "app.js").resolve()
    assert resolve(web, "/") == (web / "index.html").resolve()
    assert resolve(web, "/assets") is None  # a directory without an index


def test_only_the_loopback_name_is_answered(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            status, _, _ = await get(host, "/", headers={"Host": "evil.example"})
            assert status == 403
            status, _, _ = await get(host, "/", headers={"Host": f"localhost:{host.port}"})
            assert status == 200

    run(main())


def test_without_a_built_client_only_the_socket_is_served(tmp_path, monkeypatch):
    monkeypatch.setattr(server_module, "default_web_dir", lambda: None)

    async def main():
        host = ServerHost(HostOptions(web_dir=None, runs_dir=tmp_path / "runs"))
        await host.start(0)
        try:
            status, headers, body = await get(host, "/")
            assert status == 404 and b"not built" in body
            assert "Content-Security-Policy" not in headers
            client = await Client.connect(host)
            await client.hello(seed=1)
            assert (await client.recv())["type"] == "welcome"
            await client.close()
        finally:
            await host.stop()

    run(main())


def test_a_page_without_a_policy_is_refused_rather_than_served_without_one(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    with pytest.raises(WebDirError):
        ServerHost(HostOptions(web_dir=web))
    (web / "index.html").write_text(
        "<meta http-equiv='content-security-policy' content=\"default-src 'none'\">",
        encoding="utf-8",
    )
    assert load_policy(web) == "default-src 'none'"


def test_content_types_do_not_depend_on_the_system():
    assert content_type(Path("a/b.MJS")) == "text/javascript; charset=utf-8"
    assert content_type(Path("pyodide.asm.wasm")) == "application/wasm"
    assert content_type(Path("x.unknown-extension")) == "application/octet-stream"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on the PATH")
@pytest.mark.skipif(
    not (ROOT / "web" / "dist" / "index.html").is_file(), reason="web/dist is not built"
)
def test_the_real_build_is_served_under_the_policy_the_preview_server_prints(tmp_path):
    printed = subprocess.run(
        ["node", "--no-warnings", str(ROOT / "web" / "scripts" / "print-csp.mjs")],
        capture_output=True,
        text=True,
        cwd=ROOT / "web",
        timeout=60,
    )
    assert printed.returncode == 0, printed.stderr

    async def main():
        host = ServerHost(HostOptions(web_dir=ROOT / "web" / "dist", runs_dir=tmp_path))
        await host.start(0)
        try:
            for path in ("/", "/index.html"):
                status, headers, body = await get(host, path)
                assert status == 200 and b"<div" in body
                assert headers["Content-Security-Policy"] == printed.stdout.strip()
            wasm = next((ROOT / "web" / "dist" / "pyodide").glob("*.wasm"), None)
            if wasm is not None:
                _, headers, _ = await get(host, f"/pyodide/{wasm.name}")
                assert headers["Content-Type"] == "application/wasm"
        finally:
            await host.stop()

    run(main())
