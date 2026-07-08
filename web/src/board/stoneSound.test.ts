import { afterEach, describe, expect, it, vi } from 'vitest'

describe('stone sounds', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('ignores audio play implementations that do not return a promise', async () => {
    const play = vi.fn(() => undefined)
    const AudioMock = vi.fn(function (this: { currentTime: number; play: typeof play }) {
      this.currentTime = 0
      this.play = play
    })
    vi.stubGlobal('Audio', AudioMock)

    const { playStoneSound } = await import('./stoneSound')

    expect(() => playStoneSound()).not.toThrow()
    expect(play).toHaveBeenCalledTimes(1)
  })
})
