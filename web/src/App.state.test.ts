import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')

describe('workspace state synchronization', () => {
  it('mirrors full server state instead of building analysis incrementally', () => {
    expect(app).toContain("nextClient.on('analysis.update'")
    expect(app).toContain("'workspace.state'")
    expect(app).not.toContain("'analysis.node'")
    expect(app).not.toContain('upsertChartPoint')
    expect(app).not.toContain('upsertBadMove')
  })
})
