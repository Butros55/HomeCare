import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT = 768
const PHONE_LANDSCAPE_MAX_WIDTH = 1024
const PHONE_LANDSCAPE_MAX_SHORT_SIDE = 600
const TOUCH_LANDSCAPE_MAX_WIDTH = 1366
const TOUCH_LANDSCAPE_MAX_SHORT_SIDE = 920

function isMobileViewport() {
  const width = window.visualViewport?.width ?? window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  if (width < MOBILE_BREAKPOINT) return true

  const isCoarseTouch =
    window.matchMedia("(pointer: coarse)").matches ||
    (window.matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0)

  return (
    isCoarseTouch &&
    width <= PHONE_LANDSCAPE_MAX_WIDTH &&
    Math.min(width, height) <= PHONE_LANDSCAPE_MAX_SHORT_SIDE
  )
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const mobileWidthMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const coarsePointerMql = window.matchMedia("(pointer: coarse)")
    const noHoverMql = window.matchMedia("(hover: none)")
    const onChange = () => {
      setIsMobile(isMobileViewport())
    }
    mobileWidthMql.addEventListener("change", onChange)
    coarsePointerMql.addEventListener("change", onChange)
    noHoverMql.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    window.visualViewport?.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    setIsMobile(isMobileViewport())
    return () => {
      mobileWidthMql.removeEventListener("change", onChange)
      coarsePointerMql.removeEventListener("change", onChange)
      noHoverMql.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
      window.visualViewport?.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
    }
  }, [])

  return !!isMobile
}

/**
 * True only on a phone-sized viewport held in landscape orientation.
 *
 * Used by the calendar to switch into its buttonless, week-timeline compact
 * mode. Deliberately narrower than {@link useIsMobile}: a large tablet in
 * landscape keeps the full desktop-style calendar, while a phone rotated
 * sideways gets the compact surface.
 */
function hasCoarseTouch() {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    (window.matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0)
  )
}

function isLandscapePhoneViewport() {
  if (typeof window === "undefined") return false
  const width = window.visualViewport?.width ?? window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  const isLandscape = width > height
  if (!isLandscape) return false
  const isCoarseTouch = hasCoarseTouch()
  // Phone in landscape: coarse pointer, wide-but-short, and the short side small
  // enough that it is clearly a phone (not an iPad).
  return (
    isCoarseTouch &&
    width <= PHONE_LANDSCAPE_MAX_WIDTH &&
    Math.min(width, height) <= PHONE_LANDSCAPE_MAX_SHORT_SIDE
  )
}

export function useIsLandscapePhone() {
  const [isLandscapePhone, setIsLandscapePhone] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isLandscapePhoneViewport(),
  )

  useEffect(() => {
    const orientationMql = window.matchMedia("(orientation: landscape)")
    const coarsePointerMql = window.matchMedia("(pointer: coarse)")
    const onChange = () => {
      setIsLandscapePhone(isLandscapePhoneViewport())
    }
    orientationMql.addEventListener("change", onChange)
    coarsePointerMql.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    window.visualViewport?.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    onChange()
    return () => {
      orientationMql.removeEventListener("change", onChange)
      coarsePointerMql.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
      window.visualViewport?.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
    }
  }, [])

  return isLandscapePhone
}


function isTouchLandscapeViewport() {
  if (typeof window === "undefined") return false
  const width = window.visualViewport?.width ?? window.innerWidth
  const height = window.visualViewport?.height ?? window.innerHeight
  const screenLongSide = Math.max(window.screen?.width ?? width, window.screen?.height ?? height)
  const isLandscape = width > height
  if (!isLandscape) return false

  return (
    hasCoarseTouch() &&
    Math.max(width, height) <= TOUCH_LANDSCAPE_MAX_WIDTH &&
    Math.min(width, height) <= TOUCH_LANDSCAPE_MAX_SHORT_SIDE &&
    screenLongSide <= TOUCH_LANDSCAPE_MAX_WIDTH
  )
}

export function useIsTouchLandscape() {
  const [isTouchLandscape, setIsTouchLandscape] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isTouchLandscapeViewport(),
  )

  useEffect(() => {
    const orientationMql = window.matchMedia("(orientation: landscape)")
    const coarsePointerMql = window.matchMedia("(pointer: coarse)")
    const onChange = () => {
      setIsTouchLandscape(isTouchLandscapeViewport())
    }
    orientationMql.addEventListener("change", onChange)
    coarsePointerMql.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    window.visualViewport?.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    onChange()
    return () => {
      orientationMql.removeEventListener("change", onChange)
      coarsePointerMql.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
      window.visualViewport?.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
    }
  }, [])

  return isTouchLandscape
}
