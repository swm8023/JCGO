const moveAudio = new Audio('/move.mp3')
const captureAudio = new Audio('/capture.mp3')

moveAudio.preload = 'auto'
captureAudio.preload = 'auto'

function play(audio: HTMLAudioElement): void {
  audio.currentTime = 0
  audio.play().catch(() => {})
}

export function playStoneSound(): void {
  play(moveAudio)
}

export function playCaptureSound(): void {
  play(captureAudio)
}
