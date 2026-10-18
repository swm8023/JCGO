export function appBasePath(pathname = window.location.pathname): string {
  return pathname === '/jcgo' || pathname.startsWith('/jcgo/') ? '/jcgo/' : '/'
}

export function appPath(path: string, pathname = window.location.pathname): string {
  return appBasePath(pathname) + path.replace(/^\/+/, '')
}

export function websocketURL(): string {
  const url = new URL(appPath('ws'), window.location.origin)
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}
