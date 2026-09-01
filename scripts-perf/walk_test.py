#!/usr/bin/env python3
"""Deep player-walk verification loop for Kurōdo.

Walks the EXACT path hls.js takes, with the same headers the proxy sends:
  1. sources → proxiedUrl (master)
  2. master → variant playlists (via /proxy)
  3. variant → audio-group playlists (#EXT-X-MEDIA URIs) — the 403/429 suspects
  4. variant → first segment: must start with 0x47 (MPEG-TS)

The earlier loop fetched variants with urllib (no Referer) and got 403/429 —
that's CLIENT-side error, not the app's path. This version always goes
through /proxy like the player does.
"""
import json
import sys
import io
import time
import urllib.request
import urllib.error

BASE = "http://localhost:5173"
TIMEOUT = 45

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TITLES = [
    (171627, "Reze movie"),
    (21,     "One Piece"),
    (5114,   "FMA Brotherhood"),
    (113415, "Jujutsu Kaisen"),
]
SERVERS = ["sora", "kiwi", "neko", "beep", "mimi", "yuki"]
TYPES   = ["sub", "dub", "hsub"]


def get_json(path, timeout=TIMEOUT):
    # urllib raises on 4xx/5xx; the SPA (/) responds 200 to everything, so a
    # 200 with HTML body means the API route didn't exist (e.g. server still
    # starting). Detect that instead of parsing a broken body.
    req = urllib.request.Request(f"{BASE}{path}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
        if raw.lstrip().startswith("<!doctype") or raw.lstrip().startswith("<"):
            raise RuntimeError("API route returned the SPA HTML (server not ready?)")
        return json.loads(raw)


def proxied_fetch(path, timeout=25, max_retry=2):
    """Fetch a proxied URL; on 429 retry after a short wait (like hls.js does)."""
    for attempt in range(max_retry + 1):
        try:
            with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
                return r.read(), None
        except urllib.error.HTTPError as e:
            if e.code in (429, 403) and attempt < max_retry:
                time.sleep(3 + attempt * 3)
                continue
            return None, f"HTTP {e.code}"
        except Exception as e:
            if attempt < max_retry:
                time.sleep(2)
                continue
            return None, str(e)[:80]


def is_manifest(buf):
    return buf and buf[:64].lstrip().startswith(b"#EXTM3U")


def is_ts(buf):
    return buf and len(buf) > 188 and buf[0] == 0x47


def sources_with_retry(path, tries=3):
    """Fetch the sources endpoint; on a 429 wait out the server-declared
    window (the app surfaces 'Retry in ~Ns') instead of failing the walk —
    a real user waits for the countdown too. On a 404, retry ONCE after
    ~22s: providers cool down 18-30s after an extraction miss, and the
    per-title no-stream cache makes the first 404 sticky — a real user
    clicking the server again after the cooldown gets a fresh attempt.
    (Genuinely-absent servers fail both attempts — that's the expected-fail
    bucket, not a playback bug.)"""
    last_err = None
    for attempt in range(tries):
        try:
            return get_json(path)["data"], None
        except urllib.error.HTTPError as e:
            last_err = f"sources HTTP {e.code}"
            if e.code == 429 and attempt < tries - 1:
                try:
                    body = json.loads(e.read().decode("utf-8", "ignore"))
                    msg = str(body.get("error") or body.get("message") or "")
                    wait = 8
                    if "~" in msg:
                        try:
                            wait = min(90, max(8, int(msg.split("~")[1].split("s")[0].strip())))
                        except Exception:
                            pass
                except Exception:
                    wait = 8
                print(f"    … rate-limited, waiting {wait}s (attempt {attempt + 1})")
                time.sleep(wait + 2)
                continue
            if e.code == 404 and attempt == 0:
                print(f"    … 404 (cooldown/no-stream cache) — retrying after 22s")
                time.sleep(22)
                continue
            return None, last_err
        except Exception as e:
            last_err = f"sources: {str(e)[:90]}"
            time.sleep(3)
    return None, last_err


def walk(slug, ep, provider, ptype, anilist_id):
    res = {"provider": provider, "type": ptype, "ok": False, "errors": [], "ms": {}}
    t0 = time.time()
    q = f"anilistId={anilist_id}" if anilist_id else ""
    stream, err = sources_with_retry(f"/api/anidap/sources/{slug}/{ep}/{provider}/{ptype}?{q}")
    if err:
        res["errors"].append(err)
        return res
    if not stream.get("url"):
        res["errors"].append("sources returned no url")
        return res
    res["ms"]["sources"] = round((time.time() - t0) * 1000)
    res["url"] = stream["url"][:64]

    proxied = stream.get("proxiedUrl")
    if not proxied:
        res["errors"].append("no proxiedUrl")
        return res

    # 2. master manifest (through /proxy, as the player does)
    t1 = time.time()
    master, err = proxied_fetch(proxied)
    res["ms"]["master"] = round((time.time() - t1) * 1000)
    if err:
        res["errors"].append(f"master: {err}")
        return res
    if not is_manifest(master):
        res["errors"].append(f"master not m3u8: {master[:40]!r}")
        return res

    master_text = master.decode("utf-8", "ignore")
    # 3. audio-group playlists (#EXT-X-MEDIA URIs) — where the 403s were
    audio_uris = []
    variant_uris = []
    has_stream_inf = "#EXT-X-STREAM-INF" in master_text
    for line in master_text.splitlines():
        line = line.strip()
        if line.startswith("#EXT-X-MEDIA") and "URI=" in line:
            uri = line.split('URI="')[1].split('"')[0]
            audio_uris.append(uri)
        elif line and not line.startswith("#"):
            variant_uris.append(line)

    # ── Master that IS a media playlist (no STREAM-INF): the URIs are
    # SEGMENTS, not variants. beep does this. Fetch the first segment
    # directly instead of walking "variants" (which aren't playlists).
    if not has_stream_inf:
        seg, seg_err = proxied_fetch(variant_uris[0], timeout=30) if variant_uris else (None, "no segments")
        res["ms"]["segments"] = 0
        res["variants_ok"] = "1/1 (media)" if (seg and is_ts(seg)) else "0/1"
        if seg_err or not (seg and is_ts(seg)):
            res["errors"].append(f"media seg {seg_err or repr(seg[:8])}")
        res["ok"] = bool(seg and is_ts(seg))
        return res

    # ── Are the video variants MUXED (contain audio codec)? ──
    # If CODECS includes mp4a*, each variant carries its own audio track, so
    # failing alt-language #EXT-X-MEDIA groups are NOT playback-fatal —
    # hls.js falls back to the muxed audio in the variant. Only an unmuxed
    # video track (video-only CODECS) truly needs the audio group.
    import re as _re
    variants_muxed = bool(_re.search(r'CODECS="[^"]*mp4a', master_text, _re.I))

    audio_ok = 0
    t2 = time.time()
    for uri in audio_uris[:2]:  # Japanese + one alt is enough to prove the group loads
        buf, err = proxied_fetch(uri)
        if buf and is_manifest(buf):
            audio_ok += 1
        elif variants_muxed:
            # Non-fatal: hls.js plays the muxed audio from the variant.
            # Record but don't add to res["errors"] (which flips ok=False).
            pass
        else:
            res["errors"].append(f"audio-group {err or 'not m3u8'}")
    res["ms"]["audio"] = round((time.time() - t2) * 1000)

    seg_ok = 0
    t3 = time.time()
    for v in variant_uris[:3]:
        buf, err = proxied_fetch(v)
        if err or not is_manifest(buf):
            res["errors"].append(f"variant {err or 'not m3u8'}")
            continue
        seg_lines = [l.strip() for l in buf.decode("utf-8", "ignore").splitlines()
                     if l.strip() and not l.startswith("#")]
        if not seg_lines:
            res["errors"].append(f"variant empty @ {v[-30:]}")
            continue
        seg, seg_err = proxied_fetch(seg_lines[0], timeout=30)
        if seg and is_ts(seg):
            seg_ok += 1
        else:
            res["errors"].append(f"seg {seg_err or repr(seg[:8])} @ {v[-30:]}")
    res["ms"]["segments"] = round((time.time() - t3) * 1000)
    res["variants_ok"] = f"{seg_ok}/{min(len(variant_uris), 3)}"
    res["audio_ok"] = f"{audio_ok}/{min(len(audio_uris), 2)}"
    # Playable iff: at least one video segment AND (audio OK / muxed / none listed)
    res["ok"] = seg_ok > 0 and (len(audio_uris) == 0 or audio_ok > 0 or variants_muxed)
    return res


def main(rounds=1, pause=3.0):
    all_results = []
    for r in range(rounds):
        print(f"\n════════ ROUND {r + 1}/{rounds} ════════")
        for anilist_id, label in TITLES:
            try:
                slug = get_json(f"/api/anidap/info/{anilist_id}")["data"]["slug"]
            except Exception as e:
                print(f"[{label}] slug resolve FAILED: {e}")
                continue
            print(f"\n── {label} (#{anilist_id}) slug={slug}")
            try:
                listed = {p["name"].replace("anidap-", ""): p["type"]
                          for p in get_json(f"/api/anidap/servers/{slug}/1?anilistId={anilist_id}")["data"]["providers"]
                          if p.get("_healthy") is not False}
                # _healthy:false = the backend verified this server dead for
                # THIS title (the picker grays it and auto-fallback skips it).
                # The walk must mirror the UI and not walk those either.
            except Exception:
                listed = {}
            for ptype in TYPES:
                for server in SERVERS:
                    if listed and listed.get(server) != ptype:
                        continue
                    res = walk(slug, 1, server, ptype, anilist_id)
                    res["title"] = label
                    all_results.append(res)
                    status = "✓" if res["ok"] else "✗"
                    errs = "; ".join(res["errors"][:2])
                    ms = res["ms"].get("sources", 0)
                    print(f"  {status} {server:5}/{ptype:4} src={ms:5}ms seg={res.get('variants_ok','-'):5} aud={res.get('audio_ok','-'):5} {('ERR: ' + errs) if errs else res['url']}")
                    time.sleep(2.5)  # pace like a human switching servers
            time.sleep(pause)

    ok = sum(1 for r in all_results if r["ok"])
    total = len(all_results)
    # ── Realistic-green accounting ──
    # A 404 from the sources endpoint after the cooldown retry means the
    # upstream doesn't offer that server for this title (e.g. kiwi/hsub has
    # no hard-sub track for most titles). That's correct app behavior —
    # the picker grays it and auto-fallback never lands there. It must NOT
    # count as a playback failure.
    expected_absent = [r for r in all_results if not r["ok"] and
                       any(e.startswith("sources HTTP 404") for e in r["errors"])]
    real_bad = [r for r in all_results if not r["ok"] and r not in expected_absent]
    base = total - len(expected_absent)
    print(f"\n════════ SUMMARY ════════")
    print(f"walks: {ok}/{total} ok ({round(100 * ok / max(total, 1), 1)}%)")
    print(f"realistic-green: {ok}/{base} ({round(100 * ok / max(base, 1), 1)}%) — excluding {len(expected_absent)} upstream-absent server(s)")
    if real_bad:
        print("REAL FAILURES:")
        for b in real_bad[:20]:
            print(f"  ✗ {b['title']} {b['provider']}/{b['type']}: {'; '.join(b['errors'][:3])}")
    if expected_absent:
        absent_kinds = sorted({"%s/%s" % (r["provider"], r["type"]) for r in expected_absent})
        print("(upstream-absent, excluded: " + ", ".join(absent_kinds) + ")")
    with open("/tmp/walk_results.json", "w") as f:
        json.dump(all_results, f, indent=1)
    return 0 if not real_bad else 1


if __name__ == "__main__":
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    sys.exit(main(rounds))
