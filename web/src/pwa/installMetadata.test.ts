import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

describe('PWA install metadata', () => {
  it('allows runtime orientation changes so mobile import can use portrait', () => {
    expect(manifest.orientation).toBe('any')
  })

  it('registers as an installed app share target for SGF files', () => {
    expect(manifest.share_target).toEqual({
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [
          {
            name: 'sgf',
            accept: ['.sgf', 'application/x-go-sgf', 'application/octet-stream', 'text/plain'],
          },
        ],
      },
    })
  })

  it('provides installable Go-themed app icons for desktop and mobile launchers', () => {
    expect(manifest.icons).toEqual([
      {
        src: '/icons/jcgo-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/jcgo-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/jcgo-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ])
    expect(pngSize('public/icons/jcgo-192.png')).toEqual({ width: 192, height: 192 })
    expect(pngSize('public/icons/jcgo-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngSize('public/icons/jcgo-maskable-512.png')).toEqual({ width: 512, height: 512 })
    expect(pngPixel('public/icons/jcgo-512.png', 8, 8).a).toBeLessThan(16)
    expect(pngPixel('public/icons/jcgo-512.png', 430, 420)).toMatchObject({ r: expect.any(Number), g: expect.any(Number), b: expect.any(Number), a: 255 })
    expect(isDark(pngPixel('public/icons/jcgo-512.png', 430, 420))).toBe(true)
  })

  it('uses standalone display so installed app sizing stays consistent across launches and rotation', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toBeUndefined()
  })

  it('enables iOS home-screen standalone mode metadata', () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/png" href="/icons/jcgo-192.png" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="JCGO" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
    expect(indexHtml).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />')
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })

  it('does not keep unused legacy SVG icon assets in public output', () => {
    expect(existsSync(join(process.cwd(), 'public', 'favicon.svg'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'public', 'icons.svg'))).toBe(false)
  })

  it('opts into edge-to-edge viewport layout for gesture navigation devices', () => {
    expect(indexHtml).toContain('viewport-fit=cover')
  })

  it('disables page scaling for installed-app style mobile interaction', () => {
    expect(indexHtml).toContain('maximum-scale=1')
    expect(indexHtml).toContain('user-scalable=no')
  })
})

function pngSize(path: string) {
  const data = readFileSync(join(process.cwd(), path))
  expect(data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  }
}

function pngPixel(path: string, x: number, y: number) {
  const data = readFileSync(join(process.cwd(), path))
  const { width, height } = pngSize(path)
  expect(width).toBe(512)
  expect(height).toBe(512)
  const chunks = idatChunks(data)
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * 4 + 1
  const rows: Buffer[] = []
  for (let row = 0; row < height; row += 1) {
    const start = row * stride
    const filter = raw[start]
    const current = Buffer.from(raw.subarray(start + 1, start + stride))
    const previous = rows[row - 1]
    unfilterRGBA(current, previous, filter)
    rows.push(current)
  }
  const offset = x * 4
  return {
    r: rows[y][offset],
    g: rows[y][offset + 1],
    b: rows[y][offset + 2],
    a: rows[y][offset + 3],
  }
}

function idatChunks(data: Buffer) {
  const chunks: Buffer[] = []
  let offset = 8
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  return chunks
}

function unfilterRGBA(current: Buffer, previous: Buffer | undefined, filter: number) {
  const bpp = 4
  for (let i = 0; i < current.length; i += 1) {
    const left = i >= bpp ? current[i - bpp] : 0
    const up = previous?.[i] ?? 0
    const upLeft = i >= bpp ? previous?.[i - bpp] ?? 0 : 0
    if (filter === 1) current[i] = (current[i] + left) & 0xff
    else if (filter === 2) current[i] = (current[i] + up) & 0xff
    else if (filter === 3) current[i] = (current[i] + Math.floor((left + up) / 2)) & 0xff
    else if (filter === 4) current[i] = (current[i] + paeth(left, up, upLeft)) & 0xff
  }
}

function paeth(left: number, up: number, upLeft: number) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

function isDark(pixel: { r: number; g: number; b: number }) {
  return pixel.r + pixel.g + pixel.b < 120
}
