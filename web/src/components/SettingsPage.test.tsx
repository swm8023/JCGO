import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    const section = screen.getByRole('region', { name: 'Worker 状态' })
    expect(section).toHaveTextContent('1 个 Worker，1 个可用，0 个忙碌')
    expect(section).not.toHaveTextContent(`本机${'分析'}`)
    expect(section).not.toHaveTextContent(`远程${'连接'}`)
    expect(within(section).getByText('gpu-worker')).toBeInTheDocument()
    expect(within(section).getByText('windows/amd64')).toBeInTheDocument()
  })

  it('shows an empty worker-only state', () => {
    render(
      <SettingsPage
        workerStatus={{ connected: 0, available: 0, busy: 0, workers: [] }}
        onBack={vi.fn()}
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
        onBack={vi.fn()}
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
            backendLabel: 'OpenCL',
            model: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
            maxVisits: 500,
            available: true,
            busy: false,
          }],
        }}
        onBack={vi.fn()}
        onConfigureWorker={onConfigureWorker}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('模型'), 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz')
    await userEvent.clear(screen.getByLabelText('Visits'))
    await userEvent.type(screen.getByLabelText('Visits'), '900')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(onConfigureWorker).toHaveBeenCalledWith({
        workerId: 'worker-1',
        model: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz',
        maxVisits: 900,
      })
    })
  })
})
