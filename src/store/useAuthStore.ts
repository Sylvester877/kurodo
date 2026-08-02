import { create } from 'zustand'
import {
  loadAuth, saveAuth, clearAuth, fetchCurrentUser,
  type AniListAuth,
} from '../api/anilistAuth'

interface AuthStore {
  auth: AniListAuth | null
  bootstrapping: boolean
  /** Persist a fresh token (called from the /auth/callback page). */
  setAuthFromToken: (token: string, expiresIn: number) => Promise<void>
  signOut: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  auth: loadAuth(),
  bootstrapping: false,

  setAuthFromToken: async (token, expiresIn) => {
    set({ bootstrapping: true })
    try {
      const user = await fetchCurrentUser(token)
      const auth: AniListAuth = {
        token,
        expiresAt: Date.now() + expiresIn * 1000,
        user,
      }
      saveAuth(auth)
      set({ auth, bootstrapping: false })
    } catch (e) {
      console.error('AniList auth failed', e)
      clearAuth()
      set({ auth: null, bootstrapping: false })
      throw e
    }
  },

  signOut: () => {
    clearAuth()
    set({ auth: null })
  },
}))
