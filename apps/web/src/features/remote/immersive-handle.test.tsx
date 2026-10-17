import '@/styles/index.css'
import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ImmersiveHandle } from './immersive-handle'

test('edge handle moves without restoring tools, stays in bounds, and supports taps and keyboard', async () => {
  const restore = vi.fn()
  const screen = await render(
    <div className='remote-viewer'>
      <div style={{ position: 'relative', width: 600, height: 300 }}>
        <ImmersiveHandle onRestore={restore} />
      </div>
    </div>
  )
  try {
    const button = screen
      .getByRole('button', { name: '显示工具' })
      .element() as HTMLButtonElement
    const parent = button.parentElement!
    button.setPointerCapture = () => {}
    button.hasPointerCapture = () => false
    const pointer = (type: string, x: number, y: number) =>
      button.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y,
        })
      )
    const rect = parent.getBoundingClientRect()
    pointer('pointerdown', rect.right - 14, rect.top + 150)
    pointer('pointermove', rect.left + 1, rect.top + 999)
    pointer('pointerup', rect.left + 1, rect.top + 999)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(restore).not.toHaveBeenCalled()
    await expect.poll(() => button.style.left).toBe('0px')
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      rect.bottom
    )
    parent.style.height = '180px'
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      parent.getBoundingClientRect().bottom
    )
    expect(button.getBoundingClientRect().width).toBe(28)
    pointer('pointerdown', 10, 100)
    pointer('pointerup', 10, 100)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(restore).toHaveBeenCalledTimes(1)
    pointer('pointerdown', 10, 100)
    pointer('pointercancel', 10, 100)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(restore).toHaveBeenCalledTimes(1)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(restore).toHaveBeenCalledTimes(2)
  } finally {
    await screen.unmount()
  }
})
