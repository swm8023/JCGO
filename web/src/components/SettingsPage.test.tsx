import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders worker controls as a page body without a private titlebar', () => {
    render(<SettingsPage workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }} onConfigureWorker={vi.fn()} />)

    expect(screen.getByRole('region', { name: '设置内容' })).toHaveClass('app-page-body', 'settings-page')
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument()
  })

  it('renders worker status with connected worker details', () => {
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'gpu-worker',
            platform: 'windows/amd64',
            backend: 'opencl',
            cpu: 'AMD Ryzen',
            gpus: ['RTX 4070'],
            available: true,
            busy: false,
          }],
        }}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getByText('连接')).toBeInTheDocument()
    expect(within(section).getByText('可用', { selector: 'dt' })).toBeInTheDocument()
    expect(within(section).getByText('忙碌', { selector: 'dt' })).toBeInTheDocument()
    expect(section).not.toHaveTextContent(`本机${'分析'}`)
    expect(section).not.toHaveTextContent(`远程${'连接'}`)
    expect(within(section).getByText('gpu-worker')).toBeInTheDocument()
    expect(within(section).getByText('windows/amd64')).toBeInTheDocument()
    expect(within(section).getByText('OpenCL')).toBeInTheDocument()
    expect(within(section).getByText('AMD Ryzen')).toBeInTheDocument()
    expect(within(section).getByText('RTX 4070')).toBeInTheDocument()
  })

  it('combines worker counts into one compact status summary', () => {
    const { container } = render(
      <SettingsPage
        workerStatus={{ connected: 3, available: 2, busy: 1, workers: [] }}
      />,
    )

    const summary = container.querySelector('.worker-status-summary')
    expect(summary).not.toBeNull()
    expect(within(summary as HTMLElement).getByText('可用', { selector: 'strong' })).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('3', { selector: 'dd' })).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('2', { selector: 'dd' })).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('1', { selector: 'dd' })).toBeInTheDocument()
    expect(container.querySelector('.worker-status-grid')).not.toBeInTheDocument()
  })

  it('groups worker identity, metadata, controls, and state in one compact row', () => {
    const { container } = render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'gpu-worker',
            platform: 'windows/amd64',
            backend: 'cuda',
            cpu: 'AMD Ryzen',
            gpus: ['RTX 4070'],
            available: true,
            busy: false,
          }],
        }}
        onConfigureWorker={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const row = container.querySelector('.worker-row')
    expect(row).not.toBeNull()
    expect(row?.querySelector('.worker-row-identity')).toHaveTextContent('gpu-worker')
    expect(row?.querySelector('.worker-row-meta')).toHaveTextContent('windows/amd64')
    expect(row?.querySelector('.worker-row-meta')).toHaveTextContent('CUDA')
    expect(row?.querySelector('.worker-row-meta')).toHaveTextContent('AMD Ryzen')
    expect(row?.querySelector('.worker-row-meta')).toHaveTextContent('RTX 4070')
    expect(row?.querySelector('.worker-controls')).toBeInTheDocument()
    expect(row?.querySelector('.worker-row-state')).toHaveTextContent('可用')
  })

  it('shows an empty worker-only state', () => {
    render(
      <SettingsPage
        workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getByText('未连接')).toBeInTheDocument()
    expect(within(section).getByText('暂无 Worker 连接')).toBeInTheDocument()
  })

  it('shows worker errors on the worker row', () => {
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 0,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'bad-worker',
            platform: 'windows/amd64',
            available: false,
            busy: false,
            error: 'worker.model is required',
          }],
        }}
      />,
    )

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(within(section).getAllByText('不可用').length).toBeGreaterThan(0)
    expect(within(section).getByText('worker.model is required')).toBeInTheDocument()
  })

  it('configures an online worker model and visits', async () => {
    const onConfigureWorker = vi.fn().mockResolvedValue(undefined)
    render(
      <SettingsPage
        workerStatus={{
          connected: 1,
          available: 1,
          busy: 0,
          workers: [{
            id: 'worker-1',
            name: 'gpu-worker',
            platform: 'windows/amd64',
            backend: 'opencl',
            model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
            maxVisits: 500,
            available: true,
            busy: false,
          }],
        }}
        onConfigureWorker={onConfigureWorker}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('模型'), 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz')
    await userEvent.clear(screen.getByLabelText('Visits'))
    await userEvent.type(screen.getByLabelText('Visits'), '900')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(onConfigureWorker).toHaveBeenCalledWith({
        workerName: 'gpu-worker',
        model: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz',
        maxVisits: 900,
      })
    })
  })
})
