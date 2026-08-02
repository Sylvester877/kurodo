interface Props {
  size?: number
  showText?: boolean
  showTagline?: boolean
  className?: string
  /** When false, the wordmark is "KURODO" instead of "KURODO.me". */
  showDotMe?: boolean
}

/**
 * KURODO — sharp angular K mark + wordmark.
 *
 * The K is two interlocking chevrons: a white left-half (vertical bar +
 * upper-right diagonal) and a red right-half (mirror chevron). They
 * meet at a vertical seam in the middle, which is the brand's signature.
 *
 * Rebuilt as inline SVG so it's crisp at any size, ~2KB on the wire,
 * and theme-able. Use `showText` to toggle the wordmark, `showTagline`
 * for the "ANIME STREAMING" rule, and `showDotMe` to include the ".me"
 * suffix.
 */
export default function Logo({
  size = 36,
  showText = true,
  showTagline = false,
  showDotMe = true,
  className,
}: Props) {
  const RED = 'hsl(263 85% 64%)' // anikage-style violet accent — signature brand colour

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* ── White half ──────────────────────────────────────────
            Vertical bar on the left + upper diagonal that points
            up-and-right into the seam. */}
        <path
          d="M 18 6
             L 38 6
             L 38 44
             L 60 6
             L 80 6
             L 50 50
             L 38 50
             L 38 94
             L 18 94
             Z"
          fill="white"
        />

        {/* ── Red half ────────────────────────────────────────────
            Lower-right diagonal chevron, mirror of the upper white
            stroke. Starts at the seam (x=38, y=50), flares out and
            down to the bottom right. */}
        <path
          d="M 38 50
             L 60 50
             L 84 94
             L 60 94
             L 38 56
             Z"
          fill={RED}
        />
        {/* Small red accent point at the top right tip — gives the
            mark its asymmetric "speed" feel without overwhelming. */}
        <path
          d="M 60 6 L 80 6 L 72 18 Z"
          fill={RED}
          opacity="0.85"
        />
      </svg>

      {showText && (
        <div className="leading-none flex flex-col gap-1">
          <div className="flex items-baseline">
            <span
              className="font-extrabold tracking-tight text-white"
              style={{ fontSize: size * 0.55, letterSpacing: '0.02em' }}
            >
              KURODO
            </span>
            {showDotMe && (
              <span
                className="font-extrabold tracking-tight"
                style={{ fontSize: size * 0.32, color: RED, marginLeft: 2 }}
              >
                .me
              </span>
            )}
          </div>
          {showTagline && (
            <div
              className="flex items-center gap-1.5 text-white/55"
              style={{ fontSize: size * 0.18 }}
            >
              <span style={{ background: RED, height: 1, width: 14 }} />
              <span className="tracking-[0.35em] font-semibold uppercase">
                Anime Streaming
              </span>
              <span style={{ background: RED, height: 1, width: 14 }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
