import { useEffect } from 'react'

/** Sets document.title; restores previous title on unmount. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    const prev = document.title
    document.title = `${title} · Kurōdo`
    return () => { document.title = prev }
  }, [title])
}
