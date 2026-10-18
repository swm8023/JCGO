import { describe, expect, it } from 'vitest'
import { appBasePath, appPath, websocketURL } from './appPaths'

describe('application entry paths', () => {
  it('keeps unrelated and local root routes separate from the registered prefix', () => {
    expect(appBasePath('/jcgo')).toBe('/jcgo/')
    expect(appBasePath('/jcgo/events')).toBe('/jcgo/')
    expect(appPath('/shared-sgf/latest', '/jcgo/')).toBe('/jcgo/shared-sgf/latest')
    expect(appPath('ws', '/events/123')).toBe('/ws')
    expect(appBasePath('/jcgox/')).toBe('/')
  })
  it('connects the browser websocket beneath its current entry', () => {
    const previous = window.location.href
    window.history.replaceState(null, '', '/jcgo/')
    expect(new URL(websocketURL()).pathname).toBe('/jcgo/ws')
    window.history.replaceState(null, '', previous)
  })
})
