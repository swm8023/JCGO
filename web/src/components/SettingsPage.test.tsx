import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders worker status with connected worker details', () => {
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          local: { available: true },
          workers: [{
            id: 'worker-1',
            name: 'gpu-worker',
            platform: 'windows/amd64',
            available: true,
            busy: false,
          }],
        }}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(section).toHaveTextContent('1 个远程 Worker，1 个可用，0 个忙碌')
    expect(within(section).getByText('gpu-worker')).toBeInTheDocument()
    expect(within(section).getByText('windows/amd64')).toBeInTheDocument()
  })

  it('shows an empty remote worker state', () => {
    render(
      <SettingsPage
        workerStatus={{ connected: 0, available: 0, busy: 0, local: { available: false, error: 'katago missing' }, workers: [] }}
        onBack={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getByText('未连接')).toBeInTheDocument()
    expect(within(section).getByText('katago missing')).toBeInTheDocument()
  })
})
