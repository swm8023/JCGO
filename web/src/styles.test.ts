import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')

describe('responsive layout CSS', () => {
  it('fixes the application shell to the viewport and scrolls only rail panes', () => {
    expect(styles).toContain('body {\n  height: 100%;\n  margin: 0;\n  overflow: hidden;')
    expect(styles).toContain('.app-layout {\n  height: 100dvh;')
    expect(styles).toContain('.analysis-rail {\n  display: grid;\n  grid-template-rows: minmax(172px, 240px) minmax(0, 1fr);')
    expect(styles).toContain('.analysis-overview {\n  grid-template-rows: 18px minmax(0, 1fr);\n  gap: 2px;')
    expect(styles).toContain('.analysis-summary {\n  display: flex;')
    expect(styles).toContain('line-height: 1;')
    expect(styles).toContain('.winrate-chart {\n  width: 100%;\n  height: 100%;\n  min-height: 112px;')
    expect(styles).toContain('.analysis-detail-tabs {\n  grid-template-rows: 30px minmax(0, 1fr);')
    expect(styles).toContain('.analysis-tab-list {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(styles).toContain('.rail-section-body')
  })

  it('keeps mobile landscape navigation beside the board and import visible', () => {
    expect(styles).toContain('@media (orientation: landscape) and (max-height: 520px),\n  (orientation: landscape) and (max-width: 1100px) and (pointer: coarse)')
    expect(styles).toContain('grid-template-columns: 56px minmax(0, 1fr) minmax(240px, 320px);')
    expect(styles).toContain('.board-stage {\n    grid-template-columns: minmax(0, 1fr) 44px;')
    expect(styles).toContain('.game-sidebar h1 {\n    display: none;')
    expect(styles).toContain('.game-sidebar.expanded .game-list')
    expect(styles).toContain('.navigation-controls {\n    grid-column: 2;')
    expect(styles).toContain('.analysis-rail {\n    grid-template-rows: auto minmax(0, 1fr);\n    gap: 6px;')
    expect(styles).toContain('.analysis-overview {\n    grid-template-rows: 16px auto;')
    expect(styles).toContain('.winrate-chart {\n    height: clamp(118px, 30vh, 136px);\n    min-height: 0;')
    expect(styles).toContain('.candidate-row,\n  .bad-move {\n    min-height: 28px;')
  })
})
