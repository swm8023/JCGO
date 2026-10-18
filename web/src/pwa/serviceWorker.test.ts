import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')
type WorkerRequest = { url: string; method: string; mode?: string; formData?: () => Promise<{ getAll(key: string): unknown[] }> }
type WorkerEvent = { request?: WorkerRequest; waitUntil(promise: Promise<unknown>): void; respondWith(promise: Promise<Response>): void }

function worker(base: string, initial: string[] = []) {
  const origin = 'https://apps.example.test'
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const stores = new Map<string, Map<string, Response>>(initial.map((name) => [name, new Map()]))
  const precached: string[] = []
  const fetch = vi.fn(async () => new Response('network', { status: 200 }))
  const key = (request: string | WorkerRequest) => new URL(typeof request === 'string' ? request : request.url, origin).href
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const data = stores.get(name)!
      return {
        addAll: async (paths: string[]) => { precached.push(...paths) },
        match: async (request: string | WorkerRequest) => data.get(key(request))?.clone(),
        put: async (request: string | WorkerRequest, value: Response) => { data.set(key(request), value.clone()) },
        delete: async (request: string | WorkerRequest) => data.delete(key(request)),
      }
    },
  }
  runInNewContext(source, {
    URL, Response, fetch, caches,
    self: { location: { href: origin + base + 'sw.js', origin }, registration: { scope: origin + base },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => handlers.set(name, handler),
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
  })
  async function dispatch(name: string, request?: WorkerRequest) {
    let waiting: Promise<unknown> = Promise.resolve()
    let response: Promise<Response> | undefined
    handlers.get(name)!({ request, waitUntil: (promise) => { waiting = promise }, respondWith: (promise) => { response = promise } })
    await waiting
    return response ? await response : undefined
  }
  return { dispatch, stores, precached, fetch, origin }
}

describe.each(['/', '/jcgo/'])('service worker entry %s', (base) => {
  it('preserves other apps and sharing data while retiring its own old static cache', async () => {
    const prefix = base === '/' ? 'jcgo-' : 'jcgo-' + encodeURIComponent(base) + '-'
    const currentShare = prefix + 'shared-v1'
    const otherEntry = base === '/' ? 'jcgo-%2Fjcgo%2F-static-v8' : 'jcgo-static-v8'
    const sw = worker(base, ['tato-static-v1', currentShare, prefix + 'static-v7', otherEntry])
    await sw.dispatch('activate')
    expect(sw.stores.has('tato-static-v1')).toBe(true)
    expect(sw.stores.has(currentShare)).toBe(true)
    expect(sw.stores.has(otherEntry)).toBe(true)
    expect(sw.stores.has(prefix + 'static-v7')).toBe(false)
  })
  it('pre-caches icons inside its own entry and fetches manifest and navigation afresh', async () => {
    const sw = worker(base)
    await sw.dispatch('install')
    expect(sw.precached).toContain(base + 'icons/jcgo-192.png')
    expect(sw.precached).not.toContain(base)
    for (const path of ['manifest.webmanifest', 'sw.js', '']) {
      await sw.dispatch('fetch', { url: sw.origin + base + path, method: 'GET', mode: path === '' ? 'navigate' : 'cors' })
      await sw.dispatch('fetch', { url: sw.origin + base + path, method: 'GET', mode: path === '' ? 'navigate' : 'cors' })
    }
    expect(sw.fetch).toHaveBeenCalledTimes(6)
  })
  it('caches immutable bundles but keeps SGF share/read/delete and redirect scoped', async () => {
    const sw = worker(base)
    const request = { url: sw.origin + base + 'assets/index-123.js', method: 'GET' }
    await sw.dispatch('fetch', request)
    await sw.dispatch('fetch', request)
    expect(sw.fetch).toHaveBeenCalledTimes(1)
    const shared = await sw.dispatch('fetch', { url: sw.origin + base + 'share-target', method: 'POST', formData: async () => ({ getAll: () => [{ name: 'game.sgf', text: async () => '(;GM[1]SZ[19])' }] }) })
    expect(shared?.status).toBe(303)
    expect(shared?.headers.get('location')).toBe(sw.origin + base + '?share-target=sgf')
    const stored = await sw.dispatch('fetch', { url: sw.origin + base + 'shared-sgf/latest', method: 'GET' })
    expect(await stored?.json()).toEqual({ files: [{ name: 'game.sgf', text: '(;GM[1]SZ[19])' }] })
    const removed = await sw.dispatch('fetch', { url: sw.origin + base + 'shared-sgf/latest', method: 'DELETE' })
    expect(removed?.status).toBe(204)
    expect(sw.fetch).toHaveBeenCalledTimes(1)
  })
})
