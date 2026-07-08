const moveAudio = new Audio('/move.mp3')
const captureAudio = new Audio('/capture.mp3')

moveAudio.preload = 'auto'
captureAudio.preload = 'auto'

function play(audio: HTMLAudioElement): void {
  audio.currentTime = 0
  try {
    audio.play()?.catch(() => {})
  } catch {
    // Audio playback is best-effort and may be unavailable in tests or locked browsers.
  }
}

export function playStoneSound(): void {
  play(moveAudio)
}

export function playCaptureSound(): void {
  play(captureAudio)
}
