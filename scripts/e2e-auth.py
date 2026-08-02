#!/usr/bin/env python3
"""
End-to-end test of the AniList popup sign-in flow.

Boots the backend + vite dev server, opens the app with headless Chromium,
clicks the navbar Sign in button, captures the popup URL, simulates the
AniList redirect-with-token, intercepts the GraphQL "Viewer" request to
inject a fake user, and verifies the auth store gets populated.

Run with: `python3 scripts/e2e-auth.py`
"""
import json
import os
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright

BACKEND_PORT = 3001
VITE_PORT = 5173
BASE = f"http://localhost:{VITE_PORT}"
FAKE_TOKEN = "kurodo-e2e-fake-access-token"
FAKE_USER = {"id": 999999, "name": "KurodoE2E", "avatar": {"large": None}}

def log(*a): print("[e2e]", *a, flush=True)
def ok(m):   print(f"\033[32m✓\033[0m {m}", flush=True)
def fail(m):
    print(f"\n\033[31m✗ FAIL\033[0m {m}", flush=True)
    sys.exit(1)

def wait_port(port, label, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            s = socket.create_connection(("localhost", port), timeout=1)
            s.close()
            ok(f"{label} ready on :{port}")
            return
        except OSError:
            time.sleep(0.25)
    fail(f"{label} never came up on :{port}")

def start(name, args, env=None):
    log(f"start {name}: {' '.join(args)}")
    e = os.environ.copy()
    if env: e.update(env)
    p = subprocess.Popen(args, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         env=e, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         preexec_fn=os.setsid)
    return p

backend = vite = None
def cleanup():
    for p in (backend, vite):
        if p:
            try: os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except: pass
    time.sleep(0.3)
    for p in (backend, vite):
        if p:
            try: os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except: pass

try:
    backend = start("backend", ["node", "server/index.js"])
    vite = start("vite", ["node", "node_modules/vite/bin/vite.js", "--port", str(VITE_PORT), "--strictPort"])
    wait_port(BACKEND_PORT, "backend")
    wait_port(VITE_PORT, "vite", timeout=45)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = browser.new_context()

        # Intercept AniList GraphQL on ALL pages so the fake token can
        # be exchanged for a fake user without going to the network.
        def handle_route(route, request):
            if request.url.startswith("https://graphql.anilist.co"):
                body = request.post_data or ""
                if "Viewer" in body or "viewer" in body:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps({"data": {"Viewer": FAKE_USER}}),
                    )
                    return
            route.continue_()
        context.route("**/*", handle_route)

        # Capture all console messages from the main page.
        page = context.new_page()
        page.on("console", lambda m: log(f"[console {m.type}]", m.text))
        page.on("pageerror", lambda e: log("[pageerror]", e.message))

        log(f"navigating to {BASE}/")
        page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=20_000)
        ok("home page loaded")

        # Clear any persisted auth + custom client ID.
        page.evaluate("""() => {
            localStorage.removeItem('kurodo-anilist-auth')
            localStorage.removeItem('kurodo-anilist-client-id')
        }""")
        page.reload(wait_until="domcontentloaded")
        ok("local auth cleared, reloaded")

        # Stub window.open so we capture the URL without firing a real popup.
        page.evaluate("""() => {
            window.__capturedPopupUrl = null
            window.open = (url) => {
                window.__capturedPopupUrl = String(url)
                const stub = { closed: false, close() { this.closed = true } }
                window.__popupStub = stub
                return stub
            }
        }""")

        # Wait for sign-in button to render & click it.
        page.wait_for_selector('button[aria-label="Sign in with AniList"]', timeout=10_000)
        page.click('button[aria-label="Sign in with AniList"]')
        log("clicked sign-in")

        # Verify the captured popup URL.
        captured = page.evaluate("() => window.__capturedPopupUrl")
        if not captured: fail("window.open was not called")
        log("captured popup URL:", captured)
        u = urlparse(captured)
        if u.netloc != "anilist.co":  fail(f"wrong popup host: {u.netloc}")
        if u.path != "/api/v2/oauth/authorize": fail(f"wrong popup path: {u.path}")
        qs = parse_qs(u.query)
        if qs.get("response_type", [""])[0] != "token":
            fail(f"expected response_type=token, got {qs.get('response_type')}")
        if qs.get("client_id", [""])[0] != "42167":
            fail(f"expected client_id=42167, got {qs.get('client_id')}")
        if qs.get("redirect_uri", [""])[0] != f"{BASE}/auth/callback":
            fail(f"bad redirect_uri: {qs.get('redirect_uri')}")
        ok("popup URL is correct (implicit, client 42167, right redirect)")

        # Simulate AniList redirect: open callback page with fake token in fragment.
        # We need window.opener to be set so AuthCallback takes the popup branch.
        log("opening callback page with #access_token=…")
        callback_url = f"{BASE}/auth/callback#access_token={FAKE_TOKEN}&token_type=Bearer&expires_in=31536000"
        callback_page = context.new_page()
        callback_page.on("console", lambda m: log(f"[callback console {m.type}]", m.text))

        callback_page.add_init_script("""
            const opener = {
                postMessage(msg) { window.__postedToOpener = msg }
            }
            try {
                Object.defineProperty(window, 'opener', { value: opener, configurable: true })
            } catch {
                window.opener = opener
            }
        """)

        callback_page.goto(callback_url, wait_until="networkidle")
        # Wait for the AuthCallback's effect to run — we look for either
        # the "Signed in!" or "Sign-in failed" text it renders, with a
        # generous timeout because React + Suspense take a moment.
        try:
            callback_page.wait_for_function(
                "() => document.body && (document.body.innerText.includes('Signed in') "
                "|| document.body.innerText.includes('Sign-in failed') "
                "|| document.body.innerText.includes('Signing you in'))",
                timeout=10_000,
            )
        except Exception as e:
            log(f"timeout waiting for AuthCallback render: {e}")
            log("page text:", callback_page.evaluate("() => document.body?.innerText?.slice(0,500)"))
            log("page url:", callback_page.url)

        time.sleep(1.0)

        posted = callback_page.evaluate("() => window.__postedToOpener")
        if not posted: fail("callback did NOT postMessage to opener")
        log("postMessage payload:", json.dumps(posted))
        if posted.get("type") != "kurodo-anilist-auth":
            fail(f"wrong message type: {posted.get('type')}")
        if not posted.get("ok"):
            fail(f"postMessage reported failure: {posted.get('error')}")
        if posted.get("token") != FAKE_TOKEN:
            fail(f"token mismatch: {posted.get('token')}")
        ok("callback posted token back to opener correctly")

        # Dispatch the message on the main page and check the auth store.
        # The signInWithPopup() promise on the main page is still pending
        # waiting for a 'message' event matching origin + type. We fire
        # one using window.dispatchEvent so it's synchronous & in the
        # right execution context.
        result = page.evaluate("""(msg) => {
            return new Promise((resolve) => {
                // Dispatch a real MessageEvent so the listener installed
                // by signInWithPopup's addEventListener('message', ...)
                // fires synchronously.
                const ev = new MessageEvent('message', {
                    data: msg,
                    origin: window.location.origin,
                    source: window,
                })
                window.dispatchEvent(ev)
                // Give the setAuthFromToken async chain a moment to land.
                setTimeout(() => {
                    const raw = localStorage.getItem('kurodo-anilist-auth')
                    resolve({ persisted: !!raw, raw })
                }, 1500)
            })
        }""", posted)
        log("post-dispatch result:", json.dumps(result))
        time.sleep(1.0)

        auth_state = page.evaluate("""() => {
            const raw = localStorage.getItem('kurodo-anilist-auth')
            return raw ? JSON.parse(raw) : null
        }""")
        if not auth_state: fail("auth NOT persisted to localStorage")
        if auth_state.get("token") != FAKE_TOKEN:
            fail(f"persisted token wrong: {auth_state.get('token')}")
        if auth_state.get("user", {}).get("id") != FAKE_USER["id"]:
            fail(f"persisted user id wrong: {auth_state.get('user')}")
        if auth_state.get("user", {}).get("name") != FAKE_USER["name"]:
            fail(f"persisted user name wrong: {auth_state.get('user')}")
        ok("auth persisted with correct token + user")

        browser.close()

    print("\n\033[32m✓ ALL CHECKS PASSED\033[0m")
finally:
    cleanup()
