import { Subtitles, Mic, Server, Activity } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '../lib/utils'
import { sortProviders } from '../lib/providers'
import type { AnidapProvider } from '../api/anidap'

interface Props {
  providers: AnidapProvider[]
  streamType: string
  activeProvider: string | null
  onChangeProvider: (name: string) => void
  onChangeType: (type: string) => void
  /** True when the source confirmed this anime isn't available at all. */
  unavailable?: boolean
}

const TYPE_META: Record<string, { label: string; icon: typeof Mic }> = {
  sub:  { label: 'Sub',     icon: Subtitles },
  dub:  { label: 'Dub',     icon: Mic       },
  hsub: { label: 'H-Subs',  icon: Subtitles },
}

/** Provider family → display name + accent colour. */
const PROVIDER_FAMILY: Record<string, { label: string; color: string }> = {
  gogoanime: { label: 'GogoAnime', color: 'hsl(35,90%,50%)' },
  anidap:    { label: 'AniDap',    color: 'hsl(245,75%,60%)' },
}

/** Extract provider family from a server name (e.g. "gogoanime-sub" → "gogoanime"). */
function getFamily(name: string, provider?: string): string {
  if (provider) return provider.toLowerCase()
  return name.split('-')[0].toLowerCase()
}

/** Clean display name — strip provider prefix, capitalise. */
function cleanServerName(name: string): string {
  const cleaned = name.replace(/^(anidap|gogoanime)-/i, '')
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/**
 * Kurōdo server picker — premium segmented control + card grid.
 *
 * - Segmented type tabs (Sub / Dub / H-Subs) with per-type counts.
 * - Servers grouped by provider family and laid out as clickable tiles.
 * - Active tile gets a glowing border + soft radial highlight.
 * - Quality badge parsed from provider tip.
 * - Empty/unavailable states stay friendly and centered.
 */
export default function ServerPicker({
  providers, streamType, activeProvider,
  onChangeProvider, onChangeType, unavailable,
}: Props) {
  // Group by type, then sort within each type via sortProviders.
  const byType: Record<string, AnidapProvider[]> = {}
  for (const p of providers) (byType[p.type] ||= []).push(p)
  for (const t of Object.keys(byType)) {
    byType[t] = sortProviders(byType[t])
  }

  // Always render all 3 type tabs so the user sees that Dub/H-Sub
  // exist as options, even when no providers returned for that type.
  const allTypes = ['sub', 'hsub', 'dub'] as const

  const currentList = byType[streamType] ?? []

  // Group current servers by provider family for section headers
  const grouped = useMemo(() => {
    const map: Record<string, AnidapProvider[]> = {}
    for (const p of currentList) {
      const family = getFamily(p.name, p._provider)
      ;(map[family] ||= []).push(p)
    }
    // Sort families: anidap first, then gogoanime, then others
    const order = ['anidap', 'gogoanime']
    const known = order.filter((f) => map[f]?.length).map((f) => ({ family: f, servers: map[f] }))
    const unknown = Object.keys(map).filter((f) => !order.includes(f))
    return [...known, ...unknown.map((f) => ({ family: f, servers: map[f] }))]
  }, [currentList])

  if (providers.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center justify-center rounded-2xl p-8 text-center border border-white/5 bg-black/20">
        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
          <Server className="h-6 w-6 text-white/40" />
        </div>
        <p className="text-sm font-semibold text-white/80 mb-1">
          {unavailable
            ? 'Not available on any source yet'
            : 'No servers available for this episode yet'}
        </p>
        <p className="text-xs text-white/40 max-w-[280px]">
          {unavailable
            ? 'Try browsing popular titles instead.'
            : 'Check back in a moment or try another anime.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ─── Premium Segmented Control for Type Tabs ─── */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.04] max-w-fit">
        {allTypes.map((t) => {
          const meta = TYPE_META[t] ?? { label: t.toUpperCase(), icon: Subtitles }
          const Icon = meta.icon
          const count = byType[t]?.length ?? 0
          const isEmpty = count === 0
          const isActive = streamType === t
          return (
            <button
              key={t}
              onClick={() => {
                if (isEmpty) return
                onChangeType(t)
                const list = byType[t] ?? []
                if (list.length > 0) {
                  const def = list.find((p) => p.default)
                  onChangeProvider((def ?? list[0]).name)
                }
              }}
              disabled={isEmpty}
              title={
                isEmpty
                  ? `${meta.label} servers aren't available right now. This usually means the upstream source (chad.anidap.se) has no ${meta.label.toLowerCase()} stream for this title, or the family is unreachable.`
                  : `${meta.label} (${count} server${count === 1 ? '' : 's'})`
              }
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all z-10',
                isEmpty
                  ? 'opacity-30 cursor-not-allowed'
                  : isActive
                    ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/20'
                    : 'text-white/50 hover:bg-white/5 hover:text-white/80',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
              <span>{meta.label}</span>
              {count > 0 && (
                <span className={cn(
                  'text-[9px] font-mono px-1 rounded-md bg-black/30',
                  isActive ? 'text-white' : 'text-white/50',
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ─── Server Card Grid grouped by Provider ─── */}
      <div className="space-y-4">
        {grouped.map(({ family, servers }) => {
          const fam = PROVIDER_FAMILY[family]
          return (
            <div key={family} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fam?.color ?? 'hsl(245,75%,60%)' }} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {fam?.label ?? family}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {servers.map((p) => {
                  const isActive = activeProvider === p.name
                  const quality = p.tip?.match(/(\d{3,4}p|HQ|4K)/i)?.[1].toUpperCase()

                  return (
                    <button
                      key={p.name}
                      onClick={() => { if (p._healthy !== false) onChangeProvider(p.name) }}
                      disabled={p._healthy === false}
                      className={cn(
                        'relative flex flex-col p-3 rounded-xl border text-left transition-all overflow-hidden group',
                        p._healthy === false
                          ? 'opacity-20 cursor-not-allowed bg-white/[0.01] border-white/5'
                          : isActive
                            ? 'bg-primary/10 border-primary shadow-[0_0_15px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.12)]'
                            : 'bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.04]',
                      )}
                    >
                      {/* Active radial glow */}
                      {isActive && (
                        <div
                          className="absolute top-0 right-0 w-16 h-16 blur-xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ background: 'hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.25)' }}
                        />
                      )}

                      <div className="flex justify-between items-start mb-2 relative z-10 w-full">
                        <span className={cn('text-xs font-semibold truncate pr-2', isActive ? 'text-white' : 'text-white/70')}>
                          {cleanServerName(p.name)}
                        </span>
                        <Activity className={cn('h-3.5 w-3.5 shrink-0', p._healthy === false ? 'text-red-500' : 'text-emerald-500')} />
                      </div>

                      <div className="flex items-center gap-1.5 mt-auto relative z-10">
                        {quality && (
                          <span className={cn(
                            'text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1',
                            isActive ? 'bg-primary/20 text-white' : 'bg-white/10 text-white/60'
                          )}>
                            {quality}
                          </span>
                        )}
                        <span className="text-[9px] text-white/40">{p.type.toUpperCase()}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
