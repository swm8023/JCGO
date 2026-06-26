import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenGate } from './TokenGate'

describe('TokenGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits a trimmed access token', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    const onSubmit = vi.fn()
    render(<TokenGate onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Access token'), ' secret ')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onSubmit).toHaveBeenCalledWith('secret')
    expect(storage.get('jcgo.accessToken')).toBe('secret')
  })
})
