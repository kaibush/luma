// A video-only iOS fullscreen would hide the controls and intercept touch input.
// Keep the entire interactive surface together, with an immersive fallback.
export function canFullscreen(element: HTMLElement) {
  return (
    document.fullscreenEnabled === true &&
    typeof element.requestFullscreen === 'function'
  )
}
export async function enterDisplayMode(
  element: HTMLElement
): Promise<'fullscreen' | 'immersive'> {
  if (!canFullscreen(element)) return 'immersive'
  try {
    await element.requestFullscreen()
  } catch {
    return 'immersive'
  }
  // Orientation locking is optional; rejecting it must not undo working fullscreen.
  try {
    await (
      screen.orientation as ScreenOrientation & {
        lock?: (value: string) => Promise<void>
      }
    )?.lock?.('landscape')
  } catch {
    /* The user can rotate the phone manually. */
  }
  return 'fullscreen'
}
