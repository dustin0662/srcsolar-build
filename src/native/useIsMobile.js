import { useEffect, useState } from 'react'
import { isNative } from './platform.js'

export const MOBILE_BP = 768

// One breakpoint hook for the whole app. Several modules used to each keep a
// private innerWidth<768 read — three of them without a resize listener, one
// at 780px — so rotation and split-screen left stale layouts.
// In the Android shell we are always "mobile" regardless of width (tablets
// still get the touch-first chrome).
export function useIsMobile(bp = MOBILE_BP) {
  const read = () => isNative || (typeof window !== 'undefined' && window.innerWidth < bp)
  const [mob, setMob] = useState(read)
  useEffect(() => {
    const h = () => setMob(read())
    window.addEventListener('resize', h)
    window.addEventListener('orientationchange', h)
    return () => { window.removeEventListener('resize', h); window.removeEventListener('orientationchange', h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp])
  return mob
}
