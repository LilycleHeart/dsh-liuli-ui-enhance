import { useEffect, useState } from 'react'

/** Close interaction immediately, then unmount after a short exit animation. */
export function usePopupPresence(open: boolean, exitMs = 120): { mounted: boolean; closing: boolean } {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) {
      setPresent(true)
      return
    }
    if (!present) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false)
      return
    }
    const timer = window.setTimeout(() => { setPresent(false) }, exitMs)
    return () => { window.clearTimeout(timer) }
  }, [open, present, exitMs])
  return { mounted: open || present, closing: !open && present }
}

/** Retain the last non-null card content while its exit animation completes. */
export function usePopupValuePresence<T>(value: T | null, exitMs = 120): { value: T | null; closing: boolean } {
  const [shown, setShown] = useState<T | null>(value)
  useEffect(() => {
    if (value !== null) {
      setShown(value)
      return
    }
    if (shown === null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(null)
      return
    }
    const timer = window.setTimeout(() => { setShown(null) }, exitMs)
    return () => { window.clearTimeout(timer) }
  }, [value, shown, exitMs])
  return { value: value ?? shown, closing: value === null && shown !== null }
}
