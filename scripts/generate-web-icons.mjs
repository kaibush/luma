import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const source = await readFile(new URL('../apps/web/src/assets/remote-console.svg', import.meta.url), 'utf8')
const publicDirectory = new URL('../apps/web/public/', import.meta.url)
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage()
  const renderIcon = async (size, opaque = false) => {
    const data = await page.evaluate(async ({ source, size, opaque }) => {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml')
      if (opaque) document.querySelector('[data-background]').setAttribute('rx', '0')
      const icon = new Image()
      icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`
      await icon.decode()
      const canvas = window.document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(icon, 0, 0, size, size)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { source, size, opaque })
    return Buffer.from(data, 'base64')
  }

  await writeFile(new URL('favicon.svg', publicDirectory), source)
  for (const [filename, size, opaque] of [
    ['favicon-32.png', 32, false],
    ['apple-touch-icon.png', 180, true],
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
  ]) {
    await writeFile(new URL(filename, publicDirectory), await renderIcon(size, opaque))
    console.log(`${filename}: ${size}×${size}`)
  }

  const sizes = [16, 32, 48]
  const images = []
  for (const size of sizes) images.push(await renderIcon(size))
  const directory = Buffer.alloc(6 + sizes.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(sizes.length, 4)
  let offset = directory.length
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16
    directory[entry] = directory[entry + 1] = size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(images[index].length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  })
  await writeFile(new URL('favicon.ico', publicDirectory), Buffer.concat([directory, ...images]))
  console.log('favicon.svg and favicon.ico: exported from the shared SVG')
} finally {
  await browser.close()
}
