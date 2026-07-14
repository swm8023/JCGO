import { describe, expect, it } from 'vitest'
import { appLayer, importModeForLayer, isRootPageLayer, pageLayerFor, yuanluoboPickerForLayer } from './appLayers'

describe('appLayers', () => {
  it('classifies long-lived destinations as pages and pickers as overlays', () => {
    expect(appLayer('home')).toMatchObject({ kind: 'home', title: 'JCGO' })
    expect(appLayer('game-list')).toMatchObject({ kind: 'page', title: '本地棋局' })
    expect(appLayer('settings')).toMatchObject({ kind: 'page', title: '设置' })
    expect(appLayer('import-choose')).toMatchObject({ kind: 'page', title: '导入棋局' })
    expect(appLayer('import-url')).toMatchObject({ kind: 'page', title: '从链接导入' })
    expect(appLayer('import-yuanluobo')).toMatchObject({ kind: 'page', title: '元萝卜' })
    expect(appLayer('yuanluobo-player-picker')).toMatchObject({ kind: 'overlay', parent: 'import-yuanluobo' })
    expect(appLayer('yuanluobo-platform-picker')).toMatchObject({ kind: 'overlay', parent: 'import-yuanluobo' })
    expect(pageLayerFor('yuanluobo-player-picker')).toBe('import-yuanluobo')
  })

  it('keeps import rendering and picker mapping derived from the layer', () => {
    expect(importModeForLayer('import-url')).toBe('url')
    expect(importModeForLayer('import-yuanluobo')).toBe('yuanluobo')
    expect(importModeForLayer('yuanluobo-player-picker')).toBe('yuanluobo')
    expect(yuanluoboPickerForLayer('yuanluobo-player-picker')).toBe('player')
    expect(yuanluoboPickerForLayer('yuanluobo-platform-picker')).toBe('platform')
    expect(yuanluoboPickerForLayer('import-yuanluobo')).toBeUndefined()
  })

  it('identifies only the four persistent root tabs', () => {
    expect(appLayer('cloud-events')).toMatchObject({ kind: 'page', title: '云比赛' })
    expect(isRootPageLayer('game-list')).toBe(true)
    expect(isRootPageLayer('import-choose')).toBe(true)
    expect(isRootPageLayer('cloud-events')).toBe(true)
    expect(isRootPageLayer('settings')).toBe(true)
    expect(isRootPageLayer('import-url')).toBe(false)
    expect(isRootPageLayer('import-yuanluobo')).toBe(false)
  })
})
