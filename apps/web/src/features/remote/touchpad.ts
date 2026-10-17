export type Point = { x: number; y: number }
export interface TouchGesture {
  id: number
  start: Point
  previous: Point
  startedAt: number
  moved: boolean
}
export function moveTouch(
  gesture: TouchGesture,
  finger: Point,
  cursor: Point,
  width: number,
  height: number
): Point {
  if (Math.hypot(finger.x - gesture.start.x, finger.y - gesture.start.y) > 6)
    gesture.moved = true
  if (!gesture.moved || width <= 0 || height <= 0) return cursor
  const next = {
    x: Math.max(
      0,
      Math.min(1, cursor.x + (finger.x - gesture.previous.x) / width)
    ),
    y: Math.max(
      0,
      Math.min(1, cursor.y + (finger.y - gesture.previous.y) / height)
    ),
  }
  gesture.previous = finger
  return next
}
export function isTap(gesture: TouchGesture, now: number) {
  return !gesture.moved && now - gesture.startedAt <= 350
}
