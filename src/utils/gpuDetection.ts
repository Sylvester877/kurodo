/**
 * GPU detection utility for auto-tuning performance.
 *
 * Detects Iris Xe, integrated graphics, and discrete GPUs by querying
 * WebGL's UNMASKED_RENDERER_WEBGL extension. Falls back gracefully
 * when WebGL is unavailable.
 *
 * Detection tiers:
 *   'iris-xe'    — Intel Iris Xe Graphics (shared memory, roughly GT 1030 perf)
 *   'integrated' — Any iGPU not specifically Iris Xe (Intel UHD, AMD APU)
 *   'discrete'   — NVIDIA / AMD / Apple Silicon dedicated GPU
 *   'unknown'    — WebGL unavailable or renderer string unparseable
 */

export type GpuTier = 'iris-xe' | 'integrated' | 'discrete' | 'unknown'

let _cached: GpuTier | null = null

/** Detect the GPU tier once. Result is cached after the first call. */
export function detectGpuTier(): GpuTier {
  if (_cached !== null) return _cached

  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')

    // getContext returns a union type — narrow to WebGL after checking
    if (!gl || typeof (gl as WebGLRenderingContext).getExtension !== 'function') {
      _cached = 'unknown'
      return _cached
    }

    const webgl = gl as WebGLRenderingContext
    const debugInfo = webgl.getExtension('WEBGL_debug_renderer_info')
    if (!debugInfo) {
      _cached = 'unknown'
      return _cached
    }

    const renderer = webgl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string
    const lower = renderer.toLowerCase()

    // ── Iris Xe detection ──────────────────────────────────────────
    if (lower.includes('iris xe')) {
      _cached = 'iris-xe'
      return _cached
    }

    // ── Integrated GPU detection ───────────────────────────────────
    if (
      lower.includes('intel') ||
      lower.includes('uhd graphics') ||
      lower.includes('hd graphics') ||
      lower.includes('radeon graphics') && !lower.includes('radeon rx') && !lower.includes('radeon pro') ||
      lower.includes('mali') ||
      lower.includes('adreno') ||
      lower.includes('powervr') ||
      lower.includes('apple m') // M1/M2/M3/M4 are integrated (unified memory), but fast enough for discrete tier
    ) {
      // Apple Silicon is integrated but performs like a discrete GPU
      if (lower.includes('apple m')) {
        _cached = 'discrete'
        return _cached
      }
      _cached = 'integrated'
      return _cached
    }

    // ── Known discrete GPUs ────────────────────────────────────────
    if (
      lower.includes('nvidia') ||
      lower.includes('geforce') ||
      lower.includes('rtx') ||
      lower.includes('gtx') ||
      lower.includes('quadro') ||
      lower.includes('amd radeon') ||
      lower.includes('radeon rx') ||
      lower.includes('radeon pro') ||
      lower.includes('arc a') // Intel Arc discrete
    ) {
      _cached = 'discrete'
      return _cached
    }

    _cached = 'unknown'
    return _cached
  } catch {
    _cached = 'unknown'
    return _cached
  }
}

/**
 * Whether the detected GPU should use reduced-quality settings
 * (no backdrop-blur, fewer animations, lighter shadows).
 *
 * Returns true for Iris Xe and other integrated GPUs.
 * Apple Silicon is fast enough to handle full quality.
 */
export function shouldReduceQuality(): boolean {
  const tier = detectGpuTier()
  return tier === 'iris-xe' || tier === 'integrated'
}

/**
 * Get a human-readable label for the detected GPU tier.
 * Useful for settings UI and debug overlays.
 */
export function getGpuLabel(): string {
  switch (detectGpuTier()) {
    case 'iris-xe':
      return 'Intel Iris Xe Graphics'
    case 'integrated':
      return 'Integrated Graphics'
    case 'discrete':
      return 'Discrete GPU'
    case 'unknown':
      return 'Unknown GPU'
  }
}

/**
 * Recommended settings overrides for integrated GPU users.
 * Returns a partial settings object that callers can merge in.
 */
export function getIntegratedGpuDefaults() {
  return {
    // Disable GPU-expensive effects
    ambientMode: false,
    // Use instant page transitions (skip framer-motion animations)
    pageTransition: 'instant' as const,
    // Reduce preload depth to save memory bandwidth
    preloadPages: 1,
    // Disable adaptive preload (extra compute)
    preloadAdaptive: false,
    // Use simpler background (no pattern rendering)
    bgPattern: 'solid' as const,
    // Disable smooth scrolling (less repaint work)
    smoothScroll: false,
    // Reduce auto-scroll speed (fewer frames)
    autoScrollSpeed: 1,
  }
}
