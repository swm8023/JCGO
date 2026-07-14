import { CirclePlus, Cloud, Library, Settings, type LucideIcon } from 'lucide-react'
import type { AppRootLayer } from '../layout/appLayers'

type AppTabBarProps = {
  active: AppRootLayer
  onSelect(layer: AppRootLayer): void
}

const tabs: Array<{ layer: AppRootLayer; label: string; icon: LucideIcon }> = [
  { layer: 'game-list', label: '本地棋局', icon: Library },
  { layer: 'import-choose', label: '添加', icon: CirclePlus },
  { layer: 'cloud-events', label: '云比赛', icon: Cloud },
  { layer: 'settings', label: '设置', icon: Settings },
]

export function AppTabBar({ active, onSelect }: AppTabBarProps) {
  return (
    <nav className="app-tab-bar" aria-label="应用功能">
      {tabs.map(({ layer, label, icon: Icon }) => (
        <button
          key={layer}
          type="button"
          className="app-tab-button"
          aria-current={active === layer ? 'page' : undefined}
          onClick={() => onSelect(layer)}
        >
          <Icon size={20} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
