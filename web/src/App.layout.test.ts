import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')

describe('right rail layout', () => {
  it('groups current position and curve before tabbed detail lists', () => {
    const overview = app.indexOf('className="analysis-overview')
    const current = app.indexOf('<AnalysisPanel')
    const curve = app.indexOf('<AnalysisCharts')
    const detailTabs = app.indexOf('<AnalysisDetailTabs')

    expect(overview).toBeGreaterThan(0)
    expect(current).toBeGreaterThan(overview)
    expect(current).toBeGreaterThan(0)
    expect(curve).toBeGreaterThan(current)
    expect(detailTabs).toBeGreaterThan(curve)
  })

  it('keeps analysis controls out of the right rail', () => {
    const sidebar = app.indexOf('<GameSidebar')
    const rail = app.indexOf('<aside className="analysis-rail">')
    const start = app.indexOf('onStartAnalysis={startAnalysis}')

    expect(start).toBeGreaterThan(sidebar)
    expect(start).toBeLessThan(rail)
  })

  it('imports SGF payloads staged by the share target service worker', () => {
    expect(app).toContain("'/?share-target=sgf'")
    expect(app).toContain("'/shared-sgf/latest'")
    expect(app).toContain("method: 'DELETE'")
    expect(app).toContain("'game.importSgf'")
  })

  it('renders the import dialog outside the main layout', () => {
    const mainClose = app.indexOf('</main>')
    const importDialog = app.indexOf('{showImport && client && (')

    expect(mainClose).toBeGreaterThan(0)
    expect(importDialog).toBeGreaterThan(mainClose)
  })

  it('wraps the board in a measured frame after the game metadata', () => {
    const boardInfo = app.indexOf('<BoardInfo')
    const boardFrame = app.indexOf('<div ref={boardFrameRef} className="board-frame">')
    const board = app.indexOf('<Board', boardFrame)

    expect(boardInfo).toBeGreaterThan(0)
    expect(boardFrame).toBeGreaterThan(boardInfo)
    expect(board).toBeGreaterThan(boardFrame)
  })

  it('connects measured board/action allocation to the app layout', () => {
    expect(app).toContain("import { computeSideActionPlacement")
    expect(app).toContain("className={sideActionPlacement.enabled ? 'app-layout side-action-layout' : 'app-layout'}")
    expect(app).toContain('boardStageLeft: stageRect.left - layoutRect.left')
    expect(app).toContain('boardStageWidth: stageRect.width')
    expect(app).toContain('const actionRect = actionRailRef.current?.getBoundingClientRect()')
    expect(app).toContain('const boardActionHeight = Math.max(0, layoutRect.height - (stageRect.top - layoutRect.top) - horizontalActionHeight(actionRect) - analysisMinimumHeight(layout, stageRect.width))')
    expect(app).toContain('boardStageHeight: boardActionHeight')
    expect(app).toContain('ref={layoutRef}')
    expect(app).toContain('ref={boardStageRef}')
    expect(app).toContain('ref={boardFrameRef}')
    expect(app).toContain('ref={actionRailRef}')
  })

  it('derives the analysis minimum height from CSS variables', () => {
    expect(app).toContain('function analysisMinimumHeight(layout: Element, layoutWidth: number)')
    expect(app).toContain("cssPx(styles, '--portrait-summary-height')")
    expect(app).toContain("cssPx(styles, '--analysis-detail-preview-height')")
    expect(app).toContain('if (layoutWidth >= 700) return overviewHeight')
    expect(app).toContain('return overviewHeight + cssPx(styles')
  })
})
