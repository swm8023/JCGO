let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export function playStoneSound(): void {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') ctx.resume()

  const now = ctx.currentTime

  const noiseLen = 0.025
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate)
  const noiseData = noiseBuf.getChannelData(0)
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseData.length * 0.15))
  }
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuf
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.6, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen)
  const noiseHPF = ctx.createBiquadFilter()
  noiseHPF.type = 'highpass'
  noiseHPF.frequency.value = 3000
  noise.connect(noiseHPF)
  noiseHPF.connect(noiseGain)
  noiseGain.connect(ctx.destination)
  noise.start(now)
  noise.stop(now + noiseLen)

  const tone = ctx.createOscillator()
  const toneGain = ctx.createGain()
  tone.type = 'sine'
  tone.frequency.setValueAtTime(3200, now)
  tone.frequency.exponentialRampToValueAtTime(1200, now + 0.015)
  toneGain.gain.setValueAtTime(0.35, now)
  toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)
  tone.connect(toneGain)
  toneGain.connect(ctx.destination)
  tone.start(now)
  tone.stop(now + 0.03)

  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'triangle'
  body.frequency.setValueAtTime(600, now)
  body.frequency.exponentialRampToValueAtTime(250, now + 0.05)
  bodyGain.gain.setValueAtTime(0.18, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
  body.connect(bodyGain)
  bodyGain.connect(ctx.destination)
  body.start(now)
  body.stop(now + 0.06)
}
