import type { ImportDialogMode } from '../components/ImportDialog'
import type { YuanluoboPickerKind } from '../components/YuanluoboImportDialog'

export type AppHistoryLayer =
  | 'home'
  | 'game-list'
  | 'settings'
  | 'import-choose'
  | 'import-url'
  | 'import-yuanluobo'
  | 'yuanluobo-player-picker'
  | 'yuanluobo-platform-picker'

export type AppLayerKind = 'home' | 'page' | 'overlay'

export type AppLayer = {
  kind: AppLayerKind
  title: string
  parent?: AppHistoryLayer
}

const layers: Record<AppHistoryLayer, AppLayer> = {
  home: { kind: 'home', title: 'JCGO' },
  'game-list': { kind: 'page', title: '本地棋局' },
  settings: { kind: 'page', title: '设置' },
  'import-choose': { kind: 'page', title: '导入棋局' },
  'import-url': { kind: 'page', title: '从链接导入' },
  'import-yuanluobo': { kind: 'page', title: '元萝卜' },
  'yuanluobo-player-picker': { kind: 'overlay', title: '选择棋手', parent: 'import-yuanluobo' },
  'yuanluobo-platform-picker': { kind: 'overlay', title: '选择平台', parent: 'import-yuanluobo' },
}

export function appLayer(layer: AppHistoryLayer): AppLayer {
  return layers[layer]
}

export function isPageLayer(layer: AppHistoryLayer): boolean {
  return appLayer(layer).kind === 'page'
}

export function pageLayerFor(layer: AppHistoryLayer): AppHistoryLayer {
  return appLayer(layer).parent ?? layer
}

export function isImportLayer(layer: AppHistoryLayer): boolean {
  return layer === 'import-choose'
    || layer === 'import-url'
    || layer === 'import-yuanluobo'
    || appLayer(layer).kind === 'overlay'
}

export function importModeForLayer(layer: AppHistoryLayer): ImportDialogMode {
  if (layer === 'import-url') return 'url'
  if (layer === 'import-yuanluobo' || appLayer(layer).kind === 'overlay') return 'yuanluobo'
  return 'choose'
}

export function yuanluoboPickerForLayer(layer: AppHistoryLayer): YuanluoboPickerKind | undefined {
  if (layer === 'yuanluobo-player-picker') return 'player'
  if (layer === 'yuanluobo-platform-picker') return 'platform'
  return undefined
}

export const appHistoryLayers = new Set<AppHistoryLayer>(Object.keys(layers) as AppHistoryLayer[])
