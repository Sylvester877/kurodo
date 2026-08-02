import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Sparkles, ArrowRight, ArrowLeft, Check, X, Zap,
  ListVideo, Play, Bookmark, Pause, Repeat,
  Rocket, ExternalLink, Star,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'
import { setClientId, setClientSecret } from '../api/anilistAuth'
import Starfield from './Starfield'

const SETUP_DONE_KEY = 'kurodo-setup-done'

const STEPS = [
  { n: 1, label: 'Connect', icon: Zap },
  { n: 2, label: 'Customize', icon: ListVideo },
  { n: 3, label: 'Launch', icon: Rocket },
] as const

const LIST_OPTIONS = [
  { key: 'CURRENT' as const, label: 'Watching', icon: Play, desc: 'Currently airing or in-progress' },
  { key: 'PLANNING' as const, label: 'Plan to Watch', icon: Bookmark, desc: 'Your future watchlist' },
  { key: 'COMPLETED' as const, label: 'Completed', icon: Check, desc: 'Finished series' },
  { key: 'DROPPED' as const, label: 'Dropped', icon: X, desc: 'Series you dropped' },
  { key: 'PAUSED' as const, label: 'Paused', icon: Pause, desc: 'On hold' },
  { key: 'REPEATING' as const, label: 'Repeating', icon: Repeat, desc: 'Rewatching' },
]

// ── Floating particle generator (stable across renders) ──────────
function generateParticles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    // Random start position around the card
    x: Math.random() * 100,
    y: Math.random() * 100,
    // Random orbit size
    orbitX: 30 + Math.random() * 60,
    orbitY: 20 + Math.random() * 40,
    // Random speed (seconds per full orbit)
    speed: 8 + Math.random() * 14,
    // Random phase offset
    phase: Math.random() * Math.PI * 2,
    // Size
    size: 1.5 + Math.random() * 3,
    // Opacity
    opacity: 0.15 + Math.random() * 0.35,
    // Color tint
    hue: Math.random() < 0.5 ? 'primary' : 'purple',
    // Delay before appearing
    delay: Math.random() * 2,
  }))
}

// ── Confetti particle generator ──────────────────────────────────
function generateConfetti() {
  return Array.from({ length: 40 }, (_, i) => ({
    id: i,
    x: 0, y: 0,
    vx: (Math.random() - 0.5) * 600,
    vy: -300 - Math.random() * 500,
    // Rotation
    rotation: Math.random() * 720 - 360,
    size: 4 + Math.random() * 8,
    color: [
      'hsl(245, 75%, 60%)',  // primary purple
      'hsl(280, 65%, 55%)',  // violet
      'hsl(320, 70%, 60%)',  // pink
      'hsl(200, 80%, 60%)',  // cyan
      'hsl(160, 60%, 50%)',  // emerald
    ][Math.floor(Math.random() * 5)],
    delay: Math.random() * 0.3,
    lifetime: 1 + Math.random() * 1.5,
  }))
}

export default function SetupWizard() {
  const [step, setStep] = useState(0)
  const [clientId, setClientIdState] = useState('')
  const [clientSecret, setClientSecretState] = useState('')
  const [lists, setLists] = useState<Record<string, boolean>>({
    CURRENT: true,
    PLANNING: true,
    COMPLETED: true,
    DROPPED: false,
    PAUSED: false,
    REPEATING: false,
  })
  // Auto-skip setup if user already has watchlist/anilist data (returning user)
  const [done, setDone] = useState(() => {
    try {
      if (localStorage.getItem(SETUP_DONE_KEY) === '1') return true
      // Auto-detect returning user: if watchlist has items or anilist auth exists,
      // skip the setup wizard — they've already configured the app.
      const wl = localStorage.getItem('kurodo-watchlist')
      const auth = localStorage.getItem('kurodo-anilist-auth')
      if ((wl && wl !== '[]' && wl !== 'null') || auth) {
        localStorage.setItem(SETUP_DONE_KEY, '1')
        return true
      }
      return false
    } catch { return false }
  })
  const [launching, setLaunching] = useState(false)
  const [confetti, setConfetti] = useState<ReturnType<typeof generateConfetti> | null>(null)

  // Stable particle positions
  const particles = useMemo(() => generateParticles(25), [])

  // ── Shimmer sweep timer ──────────────────────────────────────────
  const [shimmerActive, setShimmerActive] = useState(false)
  useEffect(() => {
    let cancelled = false
    const trigger = () => {
      if (cancelled) return
      setShimmerActive(true)
      setTimeout(() => { if (!cancelled) setShimmerActive(false) }, 1200)
    }
    // First shimmer after 1s, then every 5s
    const t1 = setTimeout(trigger, 1000)
    const interval = setInterval(trigger, 5000)
    return () => { cancelled = true; clearTimeout(t1); clearInterval(interval) }
  }, [])

  const saveAndFinish = useCallback(() => {
    if (clientId.trim() && /^\d+$/.test(clientId.trim())) {
      setClientId(clientId.trim())
    }
    if (clientSecret.trim()) {
      setClientSecret(clientSecret.trim())
    }
    try { localStorage.setItem(SETUP_DONE_KEY, '1') } catch { /* ignore */ }
    setDone(true)
  }, [clientId, clientSecret])

  const handleLaunch = () => {
    setLaunching(true)
    setConfetti(generateConfetti())
    // Wait for confetti animation, then finish
    setTimeout(saveAndFinish, 1800)
  }

  const next = () => {
    if (step === STEPS.length - 1) { handleLaunch(); return }
    setStep((s) => s + 1)
  }
  const prev = () => setStep((s) => Math.max(0, s - 1))
  const skip = () => { try { localStorage.setItem(SETUP_DONE_KEY, '1') } catch { /* ignore */ }; setDone(true) }

  if (done) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-hidden">
      {/* Starfield background */}
      <Starfield />

      {/* Animated gradient overlay — slow color shift */}
      <motion.div
        className="absolute inset-0"
        animate={{
          background: [
            'radial-gradient(ellipse at 50% 50%, rgba(88,28,135,0.15) 0%, transparent 60%)',
            'radial-gradient(ellipse at 60% 40%, rgba(59,7,100,0.18) 0%, transparent 60%)',
            'radial-gradient(ellipse at 40% 60%, rgba(76,29,149,0.13) 0%, transparent 60%)',
            'radial-gradient(ellipse at 50% 50%, rgba(88,28,135,0.15) 0%, transparent 60%)',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Semi-transparent overlay — light enough to see content behind */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* ── Floating particles ────────────────────────────────────── */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className={cn(
            'absolute rounded-full pointer-events-none',
            p.hue === 'primary' ? 'bg-primary' : 'bg-purple-400',
          )}
          style={{ width: p.size, height: p.size, opacity: p.opacity }}
          animate={{
            x: [
              `${p.x}%`,
              `${p.x + p.orbitX * Math.cos(p.phase)}%`,
              `${p.x - p.orbitX * Math.sin(p.phase * 0.7)}%`,
              `${p.x + p.orbitX * Math.cos(p.phase + Math.PI)}%`,
              `${p.x}%`,
            ],
            y: [
              `${p.y}%`,
              `${p.y - p.orbitY * Math.sin(p.phase)}%`,
              `${p.y + p.orbitY * Math.cos(p.phase * 0.7)}%`,
              `${p.y - p.orbitY * Math.sin(p.phase + Math.PI)}%`,
              `${p.y}%`,
            ],
            opacity: [p.opacity, p.opacity * 1.8, p.opacity * 0.6, p.opacity * 1.4, p.opacity],
          }}
          transition={{
            duration: p.speed,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: p.delay,
          }}
        />
      ))}

      {/* ── Confetti burst on launch ──────────────────────────────── */}
      <AnimatePresence>
        {confetti && (
          <>
            {confetti.map((c) => (
              <motion.div
                key={`confetti-${c.id}`}
                className="absolute pointer-events-none rounded-sm"
                style={{
                  left: '50%',
                  top: '50%',
                  width: c.size,
                  height: c.size * 2.5,
                  background: c.color,
                  borderRadius: c.id % 3 === 0 ? '50%' : '2px',
                }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                animate={{
                  x: c.vx,
                  y: c.vy,
                  opacity: [1, 1, 0],
                  scale: [1, 1.2, 0.3],
                  rotate: c.rotation,
                }}
                transition={{
                  duration: c.lifetime,
                  delay: c.delay,
                  ease: 'easeOut',
                }}
              />
            ))}
            {/* Flash overlay */}
            <motion.div
              className="absolute inset-0 bg-white pointer-events-none"
              initial={{ opacity: 0.15 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{
          opacity: 1,
          scale: launching ? 1.03 : 1,
          y: launching ? -10 : 0,
        }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-lg mx-4"
      >
        {/* ── Pulsing glow ring ──────────────────────────────────── */}
        <motion.div
          className="absolute -inset-[3px] rounded-3xl bg-gradient-to-r from-primary/50 via-purple-500/40 to-primary/50"
          animate={{
            opacity: [0.6, 0.9, 0.6],
            filter: ['blur(6px)', 'blur(10px)', 'blur(6px)'],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── Shimmer sweep ──────────────────────────────────────── */}
        <AnimatePresence>
          {shimmerActive && (
            <motion.div
              className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="absolute -inset-full w-[200%] h-[200%]"
                style={{
                  background: 'linear-gradient(105deg, transparent 40%, rgba(168,85,247,0.08) 45%, rgba(255,255,255,0.12) 50%, rgba(168,85,247,0.08) 55%, transparent 60%)',
                }}
                initial={{ x: '-100%', y: '-100%' }}
                animate={{ x: '100%', y: '100%' }}
                transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card body — glass morphism */}
        <div className="relative rounded-3xl bg-[#0a0a0a]/95 border border-white/[0.08] backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Header with gradient */}
          <div className="relative px-6 pt-6 pb-4 bg-gradient-to-b from-primary/[0.08] to-transparent">
            {/* Skip button */}
            <button
              onClick={skip}
              className="absolute top-4 right-4 px-3 py-1.5 rounded-full text-[11px] font-medium text-white/35 hover:text-white/70 hover:bg-white/[0.05] transition-all"
            >
              Skip setup
            </button>

            <div className="flex items-center gap-3.5">
              {/* Animated logo with orbiting ring */}
              <div className="relative shrink-0">
                {/* Outer glow ring */}
                <motion.div
                  className="absolute -inset-1 rounded-2xl"
                  animate={{
                    boxShadow: [
                      '0 0 20px 4px hsla(245,75%,60%,0.3)',
                      '0 0 30px 8px hsla(245,75%,60%,0.45)',
                      '0 0 20px 4px hsla(245,75%,60%,0.3)',
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* Orbiting ring */}
                <motion.div
                  className="absolute -inset-2 rounded-2xl border border-white/10"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                  style={{
                    borderStyle: 'dashed',
                    borderWidth: '1px',
                    borderColor: 'rgba(168,85,247,0.15)',
                  }}
                />
                <motion.div
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-purple-600 grid place-items-center shadow-[0_8px_32px_-8px_hsl(245,75%,60%,0.5)]"
                >
                  <Sparkles className="h-5 w-5 text-white" />
                </motion.div>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Welcome to{' '}
                  <span className="bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite] bg-[length:200%_100%]">
                    Kurōdo
                  </span>
                </h2>
                <p className="text-[11px] text-white/45 mt-0.5">
                  Set up your anime experience in a few steps
                </p>
              </div>
            </div>
          </div>

          {/* Step indicator — premium pill style */}
          <div className="px-6 pt-4 pb-1">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <div key={s.n} className="flex items-center gap-1.5 flex-1">
                  <motion.button
                    onClick={() => i < step ? setStep(i) : undefined}
                    animate={{
                      scale: i === step ? 1 : 0.95,
                    }}
                    className={cn(
                      'relative flex items-center justify-center h-8 rounded-full text-[11px] font-bold transition-all duration-300 flex-1',
                      i < step
                        ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 cursor-pointer hover:bg-emerald-500/20'
                        : i === step
                          ? 'bg-primary/20 border border-primary/40 text-white shadow-[0_0_16px_-4px_hsl(245,75%,60%,0.4)]'
                          : 'bg-white/[0.03] border border-white/[0.06] text-white/30',
                    )}
                  >
                    {i < step ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </motion.div>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <s.icon className="h-3 w-3" />
                        <span className="hidden sm:inline">{s.label}</span>
                      </span>
                    )}
                    {/* Active glow dot */}
                    {i === step && (
                      <motion.div
                        layoutId="step-glow"
                        className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary"
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      />
                    )}
                  </motion.button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('h-px flex-[0.15] transition-colors duration-500', i < step ? 'bg-emerald-500/20' : 'bg-white/[0.04]')} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step content — animated transitions */}
          <div className="px-6 py-5 min-h-[280px]">
            <AnimatePresence mode="wait">
              {/* Step 0: AniList Connect */}
              {step === 0 && (
                <motion.div
                  key="connect"
                  initial={{ opacity: 0, x: 40, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -40, filter: 'blur(4px)' }}
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  className="space-y-4"
                >
                  <p className="text-[13px] text-white/60 leading-relaxed">
                    Connect your AniList account to sync your watchlist, track progress, and post activity automatically.
                  </p>

                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.15em] font-bold text-white/35 mb-1.5">
                        Client ID
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="\d*"
                          value={clientId}
                          onChange={(e) => setClientIdState(e.target.value.replace(/\D/g, ''))}
                          placeholder="e.g. 42167"
                          autoFocus
                          className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-3.5 py-3 text-sm font-mono tracking-wide text-white placeholder:text-white/20 outline-none focus:border-primary/50 focus:bg-white/[0.05] focus:shadow-[0_0_24px_-8px_hsl(245,75%,60%,0.35)] transition-all duration-300"
                        />
                        {clientId && /^\d+$/.test(clientId) && (
                          <motion.div
                            initial={{ scale: 0, rotate: -90 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                          >
                            <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                          </motion.div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.15em] font-bold text-white/35 mb-1.5">
                        Client Secret <span className="text-white/20 font-normal">(optional)</span>
                      </label>
                      <input
                        type="password"
                        value={clientSecret}
                        onChange={(e) => setClientSecretState(e.target.value)}
                        placeholder="Only for Confidential clients"
                        className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-3.5 py-3 text-sm font-mono text-white placeholder:text-white/20 outline-none focus:border-amber-500/30 focus:bg-white/[0.05] transition-all duration-300"
                      />
                    </div>
                  </div>

                  <a
                    href="https://anilist.co/settings/developer"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Create a Client ID at anilist.co
                  </a>
                </motion.div>
              )}

              {/* Step 1: List Preferences */}
              {step === 1 && (
                <motion.div
                  key="customize"
                  initial={{ opacity: 0, x: 40, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -40, filter: 'blur(4px)' }}
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  className="space-y-3.5"
                >
                  <p className="text-[13px] text-white/55 leading-relaxed">
                    Choose which AniList categories Kurōdo should manage:
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {LIST_OPTIONS.map((opt) => {
                      const active = lists[opt.key]
                      return (
                        <motion.button
                          key={opt.key}
                          onClick={() => setLists((l) => ({ ...l, [opt.key]: !l[opt.key] }))}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            'flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all duration-200',
                            active
                              ? 'border-primary/30 bg-primary/[0.07] text-white shadow-[0_4px_16px_-8px_hsl(245,75%,60%,0.3)]'
                              : 'border-white/[0.04] bg-white/[0.01] text-white/30 hover:text-white/50 hover:border-white/[0.08]',
                          )}
                        >
                          <opt.icon className={cn('h-4 w-4 mt-0.5 shrink-0', active ? 'text-primary' : 'text-white/20')} />
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold">{opt.label}</div>
                            <div className="text-[10px] opacity-50 leading-tight mt-0.5">{opt.desc}</div>
                          </div>
                          {active && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                              className="ml-auto h-4 w-4 rounded-full bg-primary/20 grid place-items-center shrink-0 mt-0.5"
                            >
                              <Star className="h-2.5 w-2.5 text-primary" />
                            </motion.div>
                          )}
                        </motion.button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {/* Step 2: Ready for Launch */}
              {step === 2 && (
                <motion.div
                  key="launch"
                  initial={{ opacity: 0, x: 40, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -40, filter: 'blur(4px)' }}
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  className="space-y-4"
                >
                  <div className="text-center py-3">
                    <motion.div
                      animate={launching
                        ? { scale: [1, 1.3], y: [0, -40], opacity: [1, 0] }
                        : { scale: [1, 1.05, 1] }
                      }
                      transition={launching
                        ? { duration: 0.8, ease: 'easeOut' }
                        : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
                      }
                      className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-600/10 mx-auto grid place-items-center mb-3 border border-primary/20"
                    >
                      <Rocket className="h-7 w-7 text-primary" />
                    </motion.div>
                    <motion.h3
                      className="text-sm font-bold text-white"
                      animate={launching ? { opacity: [1, 0], y: [0, -20] } : {}}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    >
                      {launching ? 'Launching...' : 'Ready for Launch'}
                    </motion.h3>
                    <motion.p
                      className="text-[11px] text-white/45 mt-2 leading-relaxed max-w-xs mx-auto"
                      animate={launching ? { opacity: [1, 0] } : {}}
                      transition={{ duration: 0.4, delay: 0.2 }}
                    >
                      {launching
                        ? 'See you on the other side! 🚀'
                        : 'Kurōdo is configured! Your AniList sync, list preferences, and activity tracking are all set.'
                      }
                    </motion.p>
                  </div>

                  {/* Summary card */}
                  <motion.div
                    className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3.5 space-y-2"
                    animate={launching ? { opacity: [1, 0], scale: [1, 0.95] } : {}}
                    transition={{ duration: 0.4, delay: 0.15 }}
                  >
                    <div className="text-[11px] text-white/50 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      AniList: {clientId ? 'Connected' : 'Skipped (set up later in Settings)'}
                    </div>
                    <div className="text-[11px] text-white/50 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Lists: {Object.entries(lists).filter(([, v]) => v).length} enabled
                    </div>
                    <div className="text-[11px] text-white/50 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Anime4K: Auto-sharpening for crystal-clear video
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer actions */}
          <div className="px-6 pb-5 flex items-center gap-2">
            {step > 0 ? (
              <button
                onClick={prev}
                className="px-4 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white/80 text-[13px] font-semibold border border-white/[0.06] transition-all flex items-center gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            ) : (
              <div />
            )}

            <button
              onClick={skip}
              className="px-3 py-2.5 text-[11px] text-white/25 hover:text-white/45 transition-colors"
            >
              Skip
            </button>

            <motion.button
              onClick={next}
              whileHover={launching ? {} : { scale: 1.02 }}
              whileTap={launching ? {} : { scale: 0.97 }}
              disabled={launching}
              className={cn(
                'ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-300',
                launching
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-purple-600 text-white shadow-[0_8px_28px_-8px_hsl(245,75%,60%,0.5)] hover:shadow-[0_12px_32px_-8px_hsl(245,75%,60%,0.65)]',
              )}
            >
              {step === STEPS.length - 1 ? (
                <>
                  {launching ? 'Launching...' : 'Launch Kurōdo'}
                  <motion.div
                    animate={launching ? { y: [0, -30], opacity: [1, 0] } : {}}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  >
                    <Rocket className="h-4 w-4" />
                  </motion.div>
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
