import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const serviceWorker = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

describe('service worker', () => {
  it('does not serve stale app shell HTML cache-first', () => {
    expect(serviceWorker).not.toContain("STATIC_ASSETS = ['/',")
    expect(serviceWorker).toContain('event.request.mode === \'navigate\'')
    expect(serviceWorker).toContain('fetch(event.request)')
  })

  it('stores SGF files received through the Web Share Target API', () => {
    expect(serviceWorker).toContain('const url = new URL(event.request.url)')
    expect(serviceWorker).toContain("url.pathname === '/share-target'")
    expect(serviceWorker).toContain("event.request.method === 'POST'")
    expect(serviceWorker).toContain(".getAll('sgf')")
    expect(serviceWorker).toContain("caches.open(SHARED_CACHE_NAME)")
    expect(serviceWorker).toContain("Response.redirect('/?share-target=sgf', 303)")
  })
})
