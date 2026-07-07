import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RotatePrompt } from './RotatePrompt'

describe('RotatePrompt', () => {
  afterEach(() => cleanup())

  it('renders nothing in portrait-only mode', () => {
    const { container } = render(<RotatePrompt />)
    expect(container.firstChild).toBeNull()
  })
})
