import { useEffect, useState } from 'react'
import axios from 'axios'
import { Wifi, WifiOff, Database, AlertTriangle } from 'lucide-react'
import { getBackendOrigin } from '../lib/utils'

interface HealthData {
  ok: boolean
  uptime: number
  memory: number
  cache: { size: number; failSize: number; streamCache: number }
  browserReady: boolean
  isRateLimited: boolean
  rateLimitRemaining: number
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

export default function WatchHealthIndicator() {
  const [health, setHealth] = useState<HealthData | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchHealth = () => {
      axios
        .get(`${getBackendOrigin()}/api/health`, { timeout: 5000, validateStatus: () => true })
        .then((r) => {
          if (!cancelled && r.data?.ok) setHealth(r.data)
        })
        .catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!health) return null

  return (
    <div className="flex items-center gap-2 text-[10px] text-white/50">
      {/* Rate-limit warning — shown first since it's the most actionable */}
      {health.isRateLimited && (
        <span
          title={`Anidap rate-limited — cooldown ${formatSeconds(health.rateLimitRemaining)} remaining`}
          className="flex items-center gap-1 text-amber-400/80"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>{formatSeconds(health.rateLimitRemaining)}</span>
        </span>
      )}

      {/* Browser bridge status */}
      <span
        title={health.browserReady ? 'Browser bridge ready' : 'Browser bridge not ready'}
        className="flex items-center gap-1"
      >
        {health.browserReady ? (
          <Wifi className="h-3 w-3 text-emerald-400" />
        ) : (
          <WifiOff className="h-3 w-3 text-white/25" />
        )}
        <span className={health.browserReady ? 'text-emerald-400/70' : 'text-white/30'}>
          {health.browserReady ? 'Ready' : 'Warming'}
        </span>
      </span>

      {/* Separator */}
      <span className="text-white/15">·</span>

      {/* Stream cache */}
      <span title={`${health.cache.streamCache} stream URLs cached`} className="flex items-center gap-1">
        <Database className="h-3 w-3" />
        <span>{health.cache.streamCache}</span>
      </span>
    </div>
  )
}
