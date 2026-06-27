import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  })

  it('prefers fullscreen display when the installed app runtime supports it', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone'])
  })

  it('enables iOS home-screen standalone mode metadata', () => {
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="JCGO" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
    expect(indexHtml).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />')
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 })
  })

  it('opts into edge-to-edge viewport layout for gesture navigation devices', () => {
    expect(indexHtml).toContain('viewport-fit=cover')
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
