import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GameLibraryPage } from './GameLibraryPage'

describe('GameLibraryPage', () => {
  it('renders a scrollable page body and selects a local game', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <GameLibraryPage
        games={[{
          gameId: 'game-1',
          displayName: 'Lee vs Cho',
          sgfFilename: 'game-1.sgf',
          result: 'B+R',
          gameDate: '2026-07-10',
          blackName: 'Lee',
          whiteName: 'Cho',
          analysisStatus: 'running',
          createdAt: '2026-07-10T10:00:00Z',
        }]}
        selectedGameId="game-1"
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    )

    const page = screen.getByRole('region', { name: '本地棋局内容' })
    expect(page).toHaveClass('app-page-body')
    expect(screen.getByText('本地棋谱')).toBeInTheDocument()
    expect(screen.queryByText('Local games')).not.toBeInTheDocument()
    expect(screen.getByText('共 1 局')).toBeInTheDocument()
    expect(screen.getByText('分析中')).toBeInTheDocument()
    const openGame = page.querySelector<HTMLButtonElement>('.game-row-open')
    expect(openGame).not.toBeNull()
    await user.click(openGame as HTMLButtonElement)
    expect(onSelect).toHaveBeenCalledWith('game-1')
  })

  it('keeps local-game outcome, metadata, and deletion controls in the page list', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(
      <GameLibraryPage
        games={[{
          gameId: 'game-1',
          displayName: 'Lee VS Cho',
          sgfFilename: 'game-1.sgf',
          result: 'B+R',
          gameDate: '2026-07-10',
          blackName: 'Lee',
          whiteName: 'Cho',
          analysisStatus: 'complete',
          createdAt: '2026-07-10T10:00:00Z',
        }]}
        selectedGameId="game-1"
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const row = container.querySelector<HTMLElement>('.game-row')
    expect(row).toHaveAttribute('data-winner', 'black')
    expect(row?.querySelectorAll('.yuanluobo-stone')).toHaveLength(2)
    expect(row?.querySelector('.local-game-result-marker')).toHaveAttribute('data-winner', 'black')
    expect(row).toHaveTextContent('2026-07-10')
    expect(row).toHaveTextContent('黑中盘胜')
    expect(row).toHaveTextContent('已分析')

    const remove = screen.getByLabelText('删除 Lee VS Cho')
    expect(remove.querySelector('svg')).toBeInTheDocument()
    await user.click(remove)
    const sheet = screen.getByRole('dialog', { name: '删除棋局' })
    expect(sheet).toHaveTextContent('Lee VS Cho')
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(within(sheet).getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith('game-1')
    expect(confirm).not.toHaveBeenCalled()
  })
})
