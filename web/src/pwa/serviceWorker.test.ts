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
})
