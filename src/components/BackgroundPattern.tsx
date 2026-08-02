import { type BgPattern, type BgTheme, getBgColor } from '../store/useReaderStore'

interface Props {
  theme: BgTheme
  pattern: BgPattern
  intensity: number
  className?: string
  children?: React.ReactNode
}

/** Renders the actual CSS background patterns behind manga pages —
 *  paper texture, gradient vignette, dotted grid, and lined notebook styles. */
export default function BackgroundPattern({ theme, pattern, intensity, className = '', children }: Props) {
  const base = getBgColor(theme)
  const alpha = intensity / 100
  const isLight = theme === 'light' || theme === 'sepia'
  const dotColor = isLight ? `rgba(0,0,0,${alpha * 0.08})` : `rgba(255,255,255,${alpha * 0.04})`
  const lineColor = isLight ? `rgba(0,0,0,${alpha * 0.06})` : `rgba(255,255,255,${alpha * 0.03})`

  let patternStyle: React.CSSProperties = {}

  switch (pattern) {
    case 'solid':
      break
    case 'paper':
      patternStyle = {
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='${alpha * 0.07}'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
      }
      break
    case 'gradient':
      patternStyle = {
        backgroundImage: `radial-gradient(ellipse at 50% 0%, ${isLight ? `rgba(0,0,0,${alpha * 0.04})` : `rgba(255,255,255,${alpha * 0.03})`} 0%, transparent 70%)`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
      }
      break
    case 'dotted':
      patternStyle = {
        backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
        backgroundSize: `16px 16px`,
      }
      break
    case 'lined':
      patternStyle = {
        backgroundImage: `linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
        backgroundSize: `100% 28px`,
      }
      break
  }

  return (
    <div
      className={`min-h-screen ${className}`}
      style={{
        backgroundColor: base,
        ...patternStyle,
      }}
    >
      {children}
    </div>
  )
}
