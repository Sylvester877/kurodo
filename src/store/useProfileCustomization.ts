// Profile customization store — persisted to localStorage.
// Avatar frames, banner overlays, badge layout preferences.
// All local-only (not synced to AniList).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AvatarFrame =
  | null           // no frame
  | 'gold-ring'    // classic gold ring
  | 'neon-glow'    // pulsing neon glow
  | 'crystal'      // crystal/ice border
  | 'flame'        // animated flame edge
  | 'cosmic'       // starry cosmic border
  | 'shadow'       // dark shadow aura

export type BannerOverlay =
  | null           // no overlay
  | 'stars'        // twinkling stars
  | 'grid'         // subtle grid pattern
  | 'waves'        // animated wave gradients
  | 'hex'          // hexagonal pattern
  | 'gradient'     // extra color gradient
  | 'particles'    // floating particles

export interface FrameMeta {
  id: AvatarFrame
  label: string
  description: string
  /** CSS class applied to the avatar container */
  className: string
  /** Inline style object for the frame */
  style: React.CSSProperties
  /** Preview ring color */
  accentColor: string
}

export interface OverlayMeta {
  id: BannerOverlay
  label: string
  description: string
  /** CSS class applied to the banner container */
  className: string
}

interface ProfileCustomizationState {
  avatarFrame: AvatarFrame
  bannerOverlay: BannerOverlay

  setAvatarFrame: (frame: AvatarFrame) => void
  setBannerOverlay: (overlay: BannerOverlay) => void
  reset: () => void
}

const DEFAULTS = {
  avatarFrame: null as AvatarFrame,
  bannerOverlay: null as BannerOverlay,
}

export const useProfileCustomization = create<ProfileCustomizationState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setAvatarFrame: (frame) => set({ avatarFrame: frame }),
      setBannerOverlay: (overlay) => set({ bannerOverlay: overlay }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'kurodo-profile-customization',
      version: 1,
    },
  ),
)

/** Avatar frame metadata — label, description, CSS, preview color */
export const FRAMES: FrameMeta[] = [
  {
    id: null,
    label: 'None',
    description: 'No decorative frame',
    className: '',
    style: {},
    accentColor: 'transparent',
  },
  {
    id: 'gold-ring',
    label: 'Gold Ring',
    description: 'A classic golden border with subtle shine',
    className: 'avatar-frame-gold',
    style: {
      boxShadow: '0 0 0 3px rgba(251,191,36,0.6), 0 0 20px rgba(251,191,36,0.2), inset 0 0 0 1px rgba(251,191,36,0.1)',
    },
    accentColor: '#fbbf24',
  },
  {
    id: 'neon-glow',
    label: 'Neon Glow',
    description: 'Pulsing electric glow around your avatar',
    className: 'avatar-frame-neon',
    style: {
      boxShadow: '0 0 0 3px rgba(0,255,255,0.7), 0 0 30px rgba(0,255,255,0.3), 0 0 60px rgba(0,255,255,0.1)',
    },
    accentColor: '#00ffff',
  },
  {
    id: 'crystal',
    label: 'Crystal',
    description: 'Frosted ice border with subtle sparkle',
    className: 'avatar-frame-crystal',
    style: {
      boxShadow: '0 0 0 3px rgba(255,255,255,0.5), 0 0 15px rgba(180,220,255,0.3), 0 0 30px rgba(180,220,255,0.1)',
    },
    accentColor: '#b4dcff',
  },
  {
    id: 'flame',
    label: 'Flame',
    description: 'Animated fire edge with warm glow',
    className: 'avatar-frame-flame',
    style: {
      boxShadow: '0 0 0 3px rgba(255,100,0,0.7), 0 0 20px rgba(255,100,0,0.3), 0 0 40px rgba(255,60,0,0.15)',
    },
    accentColor: '#ff6400',
  },
  {
    id: 'cosmic',
    label: 'Cosmic',
    description: 'Starry space border with purple shimmer',
    className: 'avatar-frame-cosmic',
    style: {
      boxShadow: '0 0 0 3px rgba(168,85,247,0.7), 0 0 25px rgba(168,85,247,0.3), 0 0 50px rgba(139,92,246,0.15)',
    },
    accentColor: '#a855f7',
  },
  {
    id: 'shadow',
    label: 'Shadow',
    description: 'Dark aura with subtle edge glow',
    className: 'avatar-frame-shadow',
    style: {
      boxShadow: '0 0 0 3px rgba(255,255,255,0.15), 0 0 40px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.6)',
    },
    accentColor: '#ffffff44',
  },
]

/** Banner overlay metadata */
export const OVERLAYS: OverlayMeta[] = [
  { id: null, label: 'None', description: 'Clean banner, no overlay', className: '' },
  { id: 'stars', label: 'Stars', description: 'Twinkling starfield overlay', className: 'banner-overlay-stars' },
  { id: 'grid', label: 'Grid', description: 'Subtle grid pattern', className: 'banner-overlay-grid' },
  { id: 'waves', label: 'Waves', description: 'Animated gradient waves', className: 'banner-overlay-waves' },
  { id: 'hex', label: 'Hexagon', description: 'Honeycomb hex pattern', className: 'banner-overlay-hex' },
  { id: 'gradient', label: 'Gradient', description: 'Extra color gradient overlay', className: 'banner-overlay-gradient' },
  { id: 'particles', label: 'Particles', description: 'Floating particle effect', className: 'banner-overlay-particles' },
]
