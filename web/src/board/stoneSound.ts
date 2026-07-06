let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export function playStoneSound(): void {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    ctx.resume()
  }

  const now = ctx.currentTime

  const click = ctx.createOscillator()
  const clickGain = ctx.createGain()
  click.type = 'sine'
  click.frequency.setValueAtTime(1800, now)
  click.frequency.exponentialRampToValueAtTime(800, now + 0.02)
  clickGain.gain.setValueAtTime(0.5, now)
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
  click.connect(clickGain)
  clickGain.connect(ctx.destination)
  click.start(now)
  click.stop(now + 0.04)

  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'triangle'
  body.frequency.setValueAtTime(420, now)
  body.frequency.exponentialRampToValueAtTime(200, now + 0.06)
  bodyGain.gain.setValueAtTime(0.25, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
  body.connect(bodyGain)
  bodyGain.connect(ctx.destination)
  body.start(now)
  body.stop(now + 0.08)
}
