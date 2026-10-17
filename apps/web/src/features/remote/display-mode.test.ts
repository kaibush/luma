import { afterEach, expect, test, vi } from 'vitest'
import { enterDisplayMode } from './display-mode'

afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals()})
test('unsupported fullscreen and rejected requests use immersive mode', async () => {
  const element = document.createElement('div')
  const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
  element.requestFullscreen = request
  const enabled = vi
    .spyOn(document, 'fullscreenEnabled', 'get')
    .mockReturnValue(false)
  expect(await enterDisplayMode(element)).toBe('immersive')
  expect(request).not.toHaveBeenCalled()
  enabled.mockReturnValue(true)
  expect(await enterDisplayMode(element)).toBe('immersive')
  expect(request).toHaveBeenCalledOnce()
})
test('orientation lock rejection does not misreport working fullscreen', async () => {
  vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true)
  const element = document.createElement('div')
  element.requestFullscreen = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('screen', {orientation:{lock:vi.fn().mockRejectedValue(new Error('Unsupported orientation lock'))}})
  expect(await enterDisplayMode(element)).toBe('fullscreen')
})
