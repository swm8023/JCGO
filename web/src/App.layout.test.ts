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

  it('renders the import dialog outside the hidden landscape layout for portrait use', () => {
    const mainClose = app.indexOf('</main>')
    const importDialog = app.indexOf('{showImport && <ImportDialog')
    const rotatePrompt = app.indexOf('<RotatePrompt')

    expect(mainClose).toBeGreaterThan(0)
    expect(importDialog).toBeGreaterThan(mainClose)
    expect(rotatePrompt).toBeGreaterThan(importDialog)
  })
})
