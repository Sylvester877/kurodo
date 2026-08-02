import { useState, useCallback } from 'react'
import {
  Shield, Key, ArrowRight, Lock, Activity, Bug, LogIn, Eye, EyeOff,
  Server,
} from 'lucide-react'
import { useTitle } from '../hooks/useTitle'
import { cn } from '../lib/utils'
import HealthPage from './Health'
import AuthDebug from './AuthDebug'
import ScraperDebug from './ScraperDebug'

type Tab = 'health' | 'scraper' | 'auth'

const TABS: Array<{ id: Tab; label: string; icon: typeof Server; description: string }> = [
  { id: 'health',  label: 'Health',  icon: Activity, description: 'System probes & endpoint diagnostics' },
  { id: 'scraper', label: 'Scraper', icon: Bug,      description: 'Anidap pipeline step-by-step probe' },
  { id: 'auth',    label: 'Auth',    icon: LogIn,     description: 'AniList OAuth & token diagnostics' },
]

// Simple passphrase gate — stored in sessionStorage so it resets when the tab closes.
const AUTH_KEY = 'kurodo-admin-authenticated'
const DEFAULT_PASSPHRASE = 'kurodo-admin'

function getStoredPassphrase(): string {
  try {
    return localStorage.getItem('kurodo-admin-passphrase') || DEFAULT_PASSPHRASE
  } catch { return DEFAULT_PASSPHRASE }
}

export default function AdminPage() {
  useTitle('Admin')
  const [authenticated, setAuthenticated] = useState(() => {
    try { return sessionStorage.getItem(AUTH_KEY) === '1' } catch { return false }
  })
  const [passphrase, setPassphrase] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('health')

  const handleUnlock = useCallback(() => {
    const correct = getStoredPassphrase()
    if (passphrase.trim() === correct) {
      sessionStorage.setItem(AUTH_KEY, '1')
      setAuthenticated(true)
      setError('')
    } else {
      setError('Incorrect passphrase')
      setPassphrase('')
    }
  }, [passphrase])

  // Allow Enter to submit
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnlock()
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen grid place-items-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="glass-card rounded-2xl p-6 border border-white/10 text-center">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/25 grid place-items-center mx-auto mb-4">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-lg font-bold text-white mb-1">Admin panel</h1>
            <p className="text-xs text-muted-foreground mb-5">
              Enter the admin passphrase to access diagnostics, scraper probes, and auth tools.
            </p>

            <div className="relative mb-3">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30">
                <Lock className="h-4 w-4" />
              </div>
              <input
                type={showPass ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => { setPassphrase(e.target.value); setError('') }}
                onKeyDown={onKeyDown}
                placeholder="Enter passphrase"
                autoFocus
                className="w-full rounded-xl bg-black/40 border border-white/10 pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary focus:bg-black/60 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-400 mb-3">{error}</p>
            )}

            <button
              onClick={handleUnlock}
              disabled={!passphrase.trim()}
              className={cn(
                'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
                passphrase.trim()
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)]'
                  : 'bg-white/5 text-white/30 cursor-not-allowed',
              )}
            >
              <Key className="h-4 w-4" />
              Unlock
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Authenticated: tabbed admin dashboard ──────────────────────
  return (
    <div className="pb-12">
      <div className="max-w-[1200px] mx-auto px-4">
        {/* Admin header */}
        <div className="glass-card rounded-2xl p-5 mb-5 border border-primary/15">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center shrink-0">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white">Admin panel</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Diagnostics, scraper probes & auth tools
              </p>
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem(AUTH_KEY)
                setAuthenticated(false)
                setPassphrase('')
              }}
              className="text-[10px] font-semibold text-white/40 hover:text-white/80 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-colors"
            >
              Lock
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
              {TABS.map((t) => {
                const Icon = t.icon
                const isActive = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all border',
                      isActive
                        ? 'bg-primary text-white border-primary shadow-[0_4px_12px_-4px_hsl(245,75%,60%,0.4)]'
                        : 'bg-white/[0.02] text-white/55 border-white/6 hover:bg-white/[0.05] hover:text-white/80 hover:border-white/12',
                    )}
                    title={t.description}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div key={tab}>
          {tab === 'health'  && <HealthPage />}
          {tab === 'scraper' && <ScraperDebug />}
          {tab === 'auth'    && <AuthDebug />}
        </div>
      </div>
    </div>
  )
}
