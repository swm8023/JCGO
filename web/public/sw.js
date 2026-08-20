const CACHE_NAME = 'jcgo-static-v6'
const SHARED_CACHE_NAME = 'jcgo-shared-v1'
const SHARED_SGF_URL = '/shared-sgf/latest'
const IMMUTABLE_ASSET_PREFIX = '/assets/'
const STATIC_ASSETS = ['/icons/jcgo-192.png', '/icons/jcgo-512.png', '/icons/jcgo-maskable-512.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(storeSharedSGF(event.request))
    return
  }
  if (url.pathname === SHARED_SGF_URL && event.request.method === 'DELETE') {
    event.respondWith(clearSharedSGF())
    return
  }
  if (event.request.method !== 'GET') return
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest' || event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request))
    return
  }
  if (url.pathname === SHARED_SGF_URL) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)))
    return
  }
  if (STATIC_ASSETS.includes(url.pathname) || isImmutableBuildAsset(url)) {
    event.respondWith(cacheFirst(event.request))
    return
  }
  event.respondWith(fetch(event.request))
})

function networkFirst(request) {
  return fetch(request).catch(() => caches.match(request))
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached
    return fetch(request).then((response) => {
      if (!response.ok) return response
      return caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()).then(() => response))
    })
  })
}

function isImmutableBuildAsset(url) {
  return url.pathname.startsWith(IMMUTABLE_ASSET_PREFIX)
}

async function storeSharedSGF(request) {
  const formData = await request.formData()
  const files = await Promise.all(
    formData
      .getAll('sgf')
      .filter(isSharedFile)
      .map(async (file) => ({
        name: file.name || 'shared.sgf',
        text: await file.text(),
      })),
  )
  const cache = await caches.open(SHARED_CACHE_NAME)
  await cache.put(
    SHARED_SGF_URL,
    new Response(JSON.stringify({ files }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    }),
  )
  return Response.redirect('/?share-target=sgf', 303)
}

async function clearSharedSGF() {
  const cache = await caches.open(SHARED_CACHE_NAME)
  await cache.delete(SHARED_SGF_URL)
  return new Response(null, { status: 204 })
}

function isSharedFile(value) {
  return value && typeof value === 'object' && typeof value.name === 'string' && typeof value.text === 'function'
}
