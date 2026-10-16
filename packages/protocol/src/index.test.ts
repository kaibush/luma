import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPoint, inputSchema } from './index.js'

test('coordinates exclude letterboxing and preserve normalized edges', () => {
  const rect = { left: 10, top: 20, width: 800, height: 600 }
  assert.equal(mapPoint(410, 40, rect, 1920, 1080), null)
  assert.deepEqual(mapPoint(410, 320, rect, 1920, 1080), { x: .5, y: .5 })
  assert.deepEqual(mapPoint(10, 95, rect, 1920, 1080), { x: 0, y: 0 })
  assert.equal(mapPoint(0, 0, rect, 0, 0), null)
  assert.equal(mapPoint(0, 0, { ...rect, width: 0 }, 1920, 1080), null)
})

test('input rejects out of range coordinates, unbounded scroll and oversized text', () => {
  assert.equal(inputSchema.safeParse({ type: 'move', x: 1.1, y: 0 }).success, false)
  assert.equal(inputSchema.safeParse({ type: 'wheel', dx: 0, dy: 999999 }).success, false)
  assert.equal(inputSchema.safeParse({ type: 'text', text: 'x'.repeat(2049) }).success, false)
  assert.equal(inputSchema.safeParse({ type: 'release-all' }).success, true)
})
