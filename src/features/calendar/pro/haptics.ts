/**
 * Best-effort selection haptic — a single subtle "tick".
 *
 * - Android / browsers with the Vibration API: `navigator.vibrate`.
 * - iOS 17.4+ / 18 (which has NO Vibration API): toggling a hidden
 *   `<input type="checkbox" switch>` emits the native switch haptic. WebKit only
 *   plays it for a control that is actually in the render tree, so the element is
 *   kept rendered (just clipped to nothing) — deliberately NOT `display:none` /
 *   `visibility:hidden` / `opacity:0`, which suppress the tick. The toggle also
 *   has to happen inside a user-activation window, so call this straight from the
 *   gesture handler (pointer move, pinch frame, tap), not long after.
 */

let switchInput: HTMLInputElement | null = null

function getSwitchInput(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null
  if (switchInput && switchInput.isConnected) return switchInput
  try {
    const label = document.createElement('label')
    label.setAttribute('aria-hidden', 'true')
    // Kept fully rendered at its natural size but parked far off-screen — WebKit
    // plays the switch haptic for a real, painted control, and the earlier
    // opacity:0 / 1px-clipped version (which suppressed the tick) is exactly what
    // stopped it working. position:fixed keeps it out of layout/scroll.
    label.style.cssText = 'position:fixed;left:-9999px;top:0;'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    label.appendChild(input)
    document.body.appendChild(label)
    switchInput = input
    return input
  } catch {
    return null
  }
}

/** Warm the hidden switch input up front (e.g. when a haptic surface mounts) so
 * the first tick isn't spent creating the element. Safe to call repeatedly. */
export function primeHaptics(): void {
  getSwitchInput()
}

/** Fire one subtle selection tick. No-op where haptics aren't available. */
export function selectionHaptic(): void {
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }
    if (typeof nav.vibrate === 'function') {
      try {
        if (nav.vibrate(8)) return
      } catch {
        /* fall through to the iOS switch fallback */
      }
    }
  }
  try {
    getSwitchInput()?.click()
  } catch {
    /* haptics unsupported — ignore */
  }
}
