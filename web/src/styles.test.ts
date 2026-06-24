import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')

describe('responsive layout CSS', () => {
  it('keeps mobile landscape navigation beside the board and import visible', () => {
    expect(styles).toContain('@media (orientation: landscape) and (max-height: 520px)')
    expect(styles).toContain('grid-template-columns: 56px minmax(0, 1fr) minmax(240px, 320px);')
    expect(styles).toContain('.board-stage {\n    grid-template-columns: minmax(0, 1fr) 44px;')
    expect(styles).toContain('.game-sidebar h1 {\n    display: none;')
    expect(styles).toContain('.game-sidebar.expanded .game-list')
    expect(styles).toContain('.navigation-controls {\n    grid-column: 2;')
  })
})
