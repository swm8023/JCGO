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

  it('prefers fullscreen display when the installed app runtime supports it', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone'])
  })

  it('enables iOS home-screen standalone mode metadata', () => {
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="JCGO" />')
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
  })

  it('opts into edge-to-edge viewport layout for gesture navigation devices', () => {
    expect(indexHtml).toContain('viewport-fit=cover')
  })
})
