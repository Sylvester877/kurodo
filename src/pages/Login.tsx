import { useEffect, useMemo, useState } from 'react'
import {
  Lock,
  ShieldCheck,
  ArrowRight,
  Loader2,
  AlertCircle,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react'
import {
  getLoginUrl,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
} from '../api/anilistAuth'
import { useTitle } from '../hooks/useTitle'

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  /login — the sign-in gate
 * ─────────────────────────────────────────────────────────────────────────
 *  Rendered OUTSIDE the app Layout: a full-screen, strictly black & white
 *  gate. Two entry paths:
 *
 *  1. Electron "Login" → opens this page in the user's DEFAULT browser at
 *     `/login?state=<relay-state>`. Signing in here goes through AniList's
 *     OAuth and /auth/callback relays the token to the backend under that
 *     state, where the desktop app is polling — the app logs in without
 *     ever leaving its window.
 *
 *  2. Plain browser visit (`/login`, no state) — normal in-browser sign-in;
 *     the token lands in this browser's localStorage like AccountMenu's flow.
 *
 *  Design language: pure monochrome. No brand colors, no gradients of hue —
 *  only blacks, whites, film grain, and typography. The card is intentionally
 *  quiet; hierarchy comes from weight and spacing.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Inline Discord brand glyph (simple-icons path, CC0). */
function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  )
}

/** Film-grain + vignette + Bleach AMV backdrop. Pure CSS/SVG + bundled video. */
function GrainBackdrop() {
  const grain = useMemo(
    () =>
      // 120×120 fractal-noise tile, inlined so it works offline.
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
    [],
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black" aria-hidden>
      {/* Bleach AMV background video, heavily dimmed to stay monochrome-dark */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: 'grayscale(1) brightness(0.42) contrast(1.15)' }}
        src="/login-bg.mp4"
        poster="/login-bg.jpg"
        autoPlay
        loop
        muted
        playsInline
      />
      {/* dark scrim so text stays legible */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.75) 100%)',
        }}
      />
      {/* soft radial light behind the card */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 42%, rgba(255,255,255,0.07), transparent 70%)',
        }}
      />
      {/* giant ghost glyph — quiet monogram watermark */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none font-mono font-bold text-white/[0.025]"
        style={{ fontSize: '46rem', lineHeight: 1 }}
      >
        黒
      </div>
      {/* film grain */}
      <div className="absolute inset-0 opacity-[0.05] mix-blend-screen" style={{ backgroundImage: grain }} />
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 90% at 50% 50%, transparent 40%, rgba(0,0,0,0.85) 100%)',
        }}
      />
    </div>
  )
}

export default function Login() {
  useTitle('Sign in')
  // Relay state: present when the desktop app opened us in an external browser.
  // `cid` rides along because the external browser can't read Electron's
  // stored credentials — the app passes its configured Client ID.
  const [params] = useState(() => new URLSearchParams(window.location.search))
  const [relayState] = useState(() => params.get('state') ?? '')
  const [passedCid] = useState(() => {
    const c = (params.get('cid') ?? '').trim()
    return /^\d+$/.test(c) ? c : ''
  })
  const [clientId, setClientIdState] = useState(passedCid || getClientId() || '')
  const [clientSecret, setClientSecretState] = useState(getClientSecret() ?? '')
  const [showAdvanced, setShowAdvanced] = useState(!passedCid && !getClientId())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The card should animate in once on mount.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const startLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)
    const cleaned = clientId.trim()
    if (!cleaned || !/^\d+$/.test(cleaned)) {
      setError('Enter your AniList Client ID — a number, e.g. 42167.')
      setShowAdvanced(true)
      return
    }
    setBusy(true)
    setClientId(cleaned)
    if (clientSecret.trim()) setClientSecret(clientSecret.trim())
    else setClientSecret(null)
    // A fresh state ties the browser session to the desktop app's poller.
    // When absent (plain browser visit) AniList just redirects back here and
    // /auth/callback signs this browser in directly.
    const state =
      relayState ||
      `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const url = getLoginUrl({ flow: 'auto', state })
    if (!url) {
      setError('Could not build the AniList authorize URL.')
      setBusy(false)
      return
    }
    window.location.href = url
  }

  const openDiscord = () => {
    // Kurōdo community server — placeholder invite kept in one place so it's
    // easy to update. Opens in a new tab in the browser context.
    window.open('https://discord.gg/anilist', '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black px-4 font-mono">
      <GrainBackdrop />

      <main
        className="relative z-10 w-full max-w-[440px] transition-all duration-700 ease-out"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0)' : 'translateY(14px)',
        }}
      >
        {/* ── The gate card ── */}
        <section
          className="rounded-2xl border border-white/10 p-8 text-center shadow-[0_24px_80px_-12px_rgba(0,0,0,0.9)] sm:p-10"
          style={{
            background: 'linear-gradient(160deg, rgba(24,24,27,0.92) 0%, rgba(9,9,11,0.96) 60%, rgba(0,0,0,0.98) 100%)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Lock tile */}
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04]">
            <Lock className="h-5 w-5 text-white/90" strokeWidth={1.75} />
          </div>

          <h1 className="text-xl font-bold uppercase tracking-[0.35em] text-white sm:text-2xl">
            Kurōdo
          </h1>

          <p className="mx-auto mt-3 max-w-[300px] text-[13px] leading-relaxed text-zinc-400">
            This library is private. Sign in with your AniList account to sync
            your lists, progress and stats.
          </p>

          {/* ── Client ID input ── */}
          <form onSubmit={startLogin} className="mt-7 space-y-3">
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={clientId}
                onChange={(e) => setClientIdState(e.target.value)}
                placeholder="AniList Client ID"
                aria-label="AniList Client ID"
                className="w-full rounded-lg border border-white/10 bg-black/60 px-4 py-3 pr-11 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-white/40 focus:ring-2 focus:ring-white/15"
              />
              <ShieldCheck
                className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500"
                strokeWidth={1.75}
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
                  Redirecting…
                </>
              ) : (
                <>
                  Sign in with AniList
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    strokeWidth={2.25}
                  />
                </>
              )}
            </button>

            {error && (
              <p className="flex items-start justify-center gap-2 text-left text-xs leading-relaxed text-red-300/90">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {error}
              </p>
            )}
          </form>

          {/* ── Advanced: client secret ── */}
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="mx-auto flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500 transition hover:text-zinc-300"
            >
              Advanced
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                strokeWidth={2}
              />
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 text-left">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                    Client secret <span className="text-zinc-600">(optional)</span>
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={clientSecret}
                    onChange={(e) => setClientSecretState(e.target.value)}
                    placeholder="Leave empty for a public client"
                    className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-white/40 focus:ring-2 focus:ring-white/15"
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Create a client at{' '}
                  <a
                    href="https://anilist.co/settings/developer"
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-300 underline decoration-white/30 underline-offset-2 hover:text-white"
                  >
                    anilist.co/settings/developer
                  </a>{' '}
                  with redirect{' '}
                  <code className="rounded bg-white/[0.06] px-1 py-0.5 text-zinc-300">
                    {window.location.origin}/auth/callback
                  </code>
                  .
                </p>
              </div>
            )}
          </div>

          {/* ── Divider ── */}
          <div className="my-7 h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent" />

          {/* ── Discord ── */}
          <button
            type="button"
            onClick={openDiscord}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] py-3 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.99]"
          >
            <DiscordGlyph className="h-[18px] w-[18px]" />
            Join Discord Server
          </button>

          <p className="mt-5 text-[11px] leading-relaxed text-zinc-600">
            Your token stays on this device — Kurōdo never sees your AniList
            password.
          </p>

          {relayState && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              After signing in, this tab hands your session back to the desktop
              app automatically.
            </p>
          )}
        </section>

        <p className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-700">
          Kurōdo · the black library
        </p>
      </main>
    </div>
  )
}
