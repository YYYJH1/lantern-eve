"""The replays in the runs folder, offered by a read-only endpoint, and only those."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import aiohttp
from host_helpers import DENSE, drive_to_tick, make_session, make_web_dir, serving

from lantern_core.replay import rebuild
from lantern_eve.replays import MAX_LISTED, list_replays, replay_path
from lantern_eve.server import HostOptions, ServerHost


def run(coro):
    return asyncio.run(coro)


async def get(host, path: str, method: str = "GET", **kwargs):
    url = f"http://127.0.0.1:{host.port}{path}"
    async with aiohttp.ClientSession() as http, http.request(method, url, **kwargs) as reply:
        return reply.status, dict(reply.headers), await reply.read()


async def raw_get(host, target: str, hostname: str | None = None) -> tuple[int, bytes]:
    """A GET with the request target exactly as given: a client library would tidy it first."""
    reader, writer = await asyncio.open_connection("127.0.0.1", host.port)
    name = hostname or f"127.0.0.1:{host.port}"
    writer.write(f"GET {target} HTTP/1.1\r\nHost: {name}\r\nConnection: close\r\n\r\n".encode())
    await writer.drain()
    data = await reader.read()
    writer.close()
    head, _, body = data.partition(b"\r\n\r\n")
    return int(head.split(b" ", 2)[1]), body


def write_game(runs: Path, seed: int, ticks: int, *, age: int = 0) -> Path:
    """Play a short game of the demo world and write its replay into ``runs``."""
    session, clock, _ = make_session(seed, runs_dir=runs, snapshot_every=60)
    drive_to_tick(session, clock, ticks)
    path = session.write_replay()
    assert path is not None
    if age:
        stamp = path.stat().st_mtime - age
        os.utime(path, (stamp, stamp))
    return path


def fake(runs: Path, name: str, text: str) -> Path:
    runs.mkdir(parents=True, exist_ok=True)
    path = runs / name
    path.write_text(text, encoding="utf-8")
    return path


# --- The list ----------------------------------------------------------------------------------


def test_each_replay_is_listed_with_what_a_list_shows_newest_first(tmp_path):
    runs = tmp_path / "runs"
    old = write_game(runs, seed=3, ticks=120, age=500)
    new = write_game(runs, seed=9, ticks=250)

    async def main():
        async with serving(tmp_path) as host:
            status, headers, body = await get(host, "/api/replays")
            assert status == 200
            assert headers["Content-Type"] == "application/json; charset=utf-8"
            assert headers["Cache-Control"] == "no-cache"
            assert headers["X-Content-Type-Options"] == "nosniff"
            listed = json.loads(body)["replays"]
            assert [r["id"] for r in listed] == [new.stem, old.stem]
            first = listed[0]
            assert (first["seed"], first["scenario"], first["host"]) == (9, "m0", "server")
            assert first["endTick"] == 250 and first["records"] > 0 and first["snapshots"] >= 4
            assert first["bytes"] == new.stat().st_size
            assert first["coreVersion"] and first["modified"].endswith("Z")
            assert set(first) == {
                "id",
                "bytes",
                "modified",
                "seed",
                "scenario",
                "coreVersion",
                "endTick",
                "records",
                "snapshots",
                "host",
            }

    run(main())


def test_a_replay_is_returned_as_it_is_and_rebuilds_to_the_hash_it_says(tmp_path):
    runs = tmp_path / "runs"
    path = write_game(runs, seed=5, ticks=300)

    async def main():
        async with serving(tmp_path) as host:
            status, headers, body = await get(host, f"/api/replays/{path.stem}")
            assert status == 200
            assert headers["Content-Type"] == "application/json; charset=utf-8"
            assert body == path.read_bytes()
            replay = json.loads(body)
            assert rebuild(replay).hash() == replay["final"]["hash"]
            # HEAD says how big it is and sends nothing.
            status, headers, body = await get(host, f"/api/replays/{path.stem}", method="HEAD")
            assert (
                status == 200
                and body == b""
                and int(headers["Content-Length"]) == len(path.read_bytes())
            )

    run(main())


def test_what_is_not_a_replay_is_not_listed(tmp_path):
    runs = tmp_path / "runs"
    good = write_game(runs, seed=1, ticks=60)
    fake(runs, "broken.json", "{ not json")
    fake(runs, "list.json", "[1, 2, 3]")
    fake(runs, "noheader.json", json.dumps({"records": [], "end_tick": 3}))
    fake(
        runs,
        "badseed.json",
        json.dumps({"header": {"seed": "x", "scenario": "m0"}, "records": [], "end_tick": 3}),
    )
    fake(runs, ".hidden.json", good.read_text(encoding="utf-8"))
    fake(runs, "notes.txt", "hello")
    fake(runs, f"{good.stem}.json.part", good.read_text(encoding="utf-8"))
    (runs / "folder.json").mkdir()
    (runs / "sub").mkdir()
    (runs / "sub" / "inside.json").write_text(good.read_text(encoding="utf-8"), encoding="utf-8")

    async def main():
        async with serving(tmp_path) as host:
            _, _, body = await get(host, "/api/replays")
            assert [r["id"] for r in json.loads(body)["replays"]] == [good.stem]
            # A file of the folder that is no replay is not listed, though it is the folder's own
            # and is given as it is. What is not a file of the folder is not given at all.
            for name in ("broken", "list", "noheader", "badseed"):
                status, body = await raw_get(host, f"/api/replays/{name}")
                assert status == 200 and body == (runs / f"{name}.json").read_bytes(), name
            for name in (".hidden", "folder", "sub%2Finside", f"{good.stem}.json", "notes"):
                status, _ = await raw_get(host, f"/api/replays/{name}")
                assert status == 404, name

    run(main())


def test_a_folder_that_is_missing_or_not_given_has_no_replays(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            _, _, body = await get(host, "/api/replays")
            assert json.loads(body) == {"replays": []}
            status, _, _ = await get(host, "/api/replays/anything")
            assert status == 404
        options = HostOptions(web_dir=make_web_dir(tmp_path / "w"), runs_dir=None, config=DENSE)
        host = ServerHost(options)
        await host.start(0)
        try:
            _, _, body = await get(host, "/api/replays")
            assert json.loads(body) == {"replays": []}
            status, _, _ = await get(host, "/api/replays/anything")
            assert status == 404
        finally:
            await host.stop()

    run(main())
    assert list_replays(None) == []
    assert replay_path(None, "x") is None


def test_the_list_is_bounded_and_follows_the_files_when_they_change(tmp_path):
    runs = tmp_path / "runs"
    one = write_game(runs, seed=2, ticks=100)
    cache: dict = {}
    before = list_replays(runs, cache)
    assert [r["endTick"] for r in before] == [100]
    # The same name with other contents is read again, and a file that went away is forgotten.
    text = json.loads(one.read_text(encoding="utf-8"))
    text["end_tick"] = 777
    one.write_text(json.dumps(text), encoding="utf-8")
    assert [r["endTick"] for r in list_replays(runs, cache)] == [777]
    assert len(cache) == 1
    one.unlink()
    assert list_replays(runs, cache) == [] and cache == {}
    # Not more than MAX_LISTED are listed, the newest ones.
    sample = json.dumps({"header": {"seed": 1, "scenario": "m0"}, "records": [], "end_tick": 1})
    for i in range(MAX_LISTED + 5):
        path = fake(runs, f"g{i:04d}.json", sample)
        os.utime(path, (1_700_000_000 + i, 1_700_000_000 + i))
    listed = list_replays(runs)
    assert len(listed) == MAX_LISTED and listed[0]["id"] == f"g{MAX_LISTED + 4:04d}"


# --- Nothing outside the folder -----------------------------------------------------------------


def test_a_name_that_leaves_the_folder_names_nothing(tmp_path):
    runs = tmp_path / "runs"
    write_game(runs, seed=4, ticks=60)
    # Files that sit beside the folder and elsewhere, which no request may reach.
    secret = fake(
        tmp_path,
        "secret.json",
        json.dumps({"header": {"seed": 1, "scenario": "m0"}, "end_tick": 1, "records": []}),
    )
    (tmp_path / "web" / "assets").mkdir(parents=True, exist_ok=True)

    async def main():
        async with serving(tmp_path) as host:
            names = [
                "..",
                "../secret",
                "..%2Fsecret",
                "%2e%2e%2fsecret",
                "%2e%2e/secret",
                "..%5Csecret",
                "%252e%252e%252fsecret",
                "secret",
                "runs%2F..%2Fsecret",
                f"{secret}",
                f"%2F{str(secret).lstrip('/').replace('/', '%2F')}",
                "%2Fetc%2Fpasswd",
                ".hidden",
                ".",
                "a%00b",
                "a%0Ab",
                "a b",
                "x" * 300,
                "caf%C3%A9",
                "..%00",
            ]
            for name in names:
                status, body = await raw_get(host, f"/api/replays/{name}")
                assert status in (400, 404), (name, status)
                assert b"secret" not in body.lower() or status == 404

    run(main())
    assert replay_path(tmp_path / "runs", "../secret") is None
    assert replay_path(tmp_path / "runs", "secret") is None


def test_a_link_in_the_folder_to_a_file_outside_it_is_neither_listed_nor_served(tmp_path):
    runs = tmp_path / "runs"
    inside = write_game(runs, seed=6, ticks=60)
    outside = fake(
        tmp_path,
        "outside.json",
        json.dumps({"header": {"seed": 1, "scenario": "m0"}, "end_tick": 1, "records": []}),
    )
    (runs / "link.json").symlink_to(outside)
    (runs / "alias.json").symlink_to(inside)

    async def main():
        async with serving(tmp_path) as host:
            _, _, body = await get(host, "/api/replays")
            ids = [r["id"] for r in json.loads(body)["replays"]]
            assert "link" not in ids
            status, _, _ = await get(host, "/api/replays/link")
            assert status == 404
            # A link to a file of the folder itself names that file, which is the folder's own.
            status, _, served = await get(host, "/api/replays/alias")
            assert status == 200 and served == inside.read_bytes()

    run(main())


def test_the_endpoint_only_reads(tmp_path):
    runs = tmp_path / "runs"
    path = write_game(runs, seed=8, ticks=60)
    before = sorted(p.name for p in runs.iterdir()) + [path.read_text(encoding="utf-8")]

    async def main():
        async with serving(tmp_path) as host:
            for method in ("POST", "PUT", "DELETE", "PATCH"):
                for target in ("/api/replays", f"/api/replays/{path.stem}", "/api/replays/new"):
                    status, headers, _ = await get(host, target, method=method, data=b"{}")
                    assert status == 405, (method, target)
                    assert "GET" in headers.get("Allow", "GET")
            await get(host, "/api/replays")
            await get(host, f"/api/replays/{path.stem}")

    run(main())
    after = sorted(p.name for p in runs.iterdir()) + [path.read_text(encoding="utf-8")]
    assert after == before


def test_requests_for_the_list_that_come_together_all_get_it(tmp_path):
    runs = tmp_path / "runs"
    for seed in range(1, 6):
        write_game(runs, seed=seed, ticks=60, age=seed * 10)

    async def main():
        async with serving(tmp_path) as host:
            replies = await asyncio.gather(*(get(host, "/api/replays") for _ in range(24)))
            assert {status for status, _, _ in replies} == {200}
            seen = {tuple(r["id"] for r in json.loads(body)["replays"]) for _, _, body in replies}
            assert len(seen) == 1 and len(next(iter(seen))) == 5

    run(main())


def test_the_check_on_the_host_header_covers_the_endpoint_too(tmp_path):
    runs = tmp_path / "runs"
    path = write_game(runs, seed=8, ticks=60)

    async def main():
        async with serving(tmp_path) as host:
            for target in ("/api/replays", f"/api/replays/{path.stem}"):
                status, _ = await raw_get(host, target, hostname="evil.example")
                assert status == 403
                status, _ = await raw_get(host, target, hostname="localhost")
                assert status == 200

    run(main())


def test_the_files_of_the_web_client_are_still_served_beside_the_endpoint(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            status, _, body = await get(host, "/assets/app.js")
            assert status == 200 and body.startswith(b"export")
            status, _, _ = await get(host, "/api/other")
            assert status == 404

    run(main())
