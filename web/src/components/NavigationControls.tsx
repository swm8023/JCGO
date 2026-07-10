import type { Color } from '../api/types'

interface NavigationControlsProps {
  moveNumber: number
  totalMoves: number
  toPlay?: Color
  canBackToMain: boolean
  interactionMode: 'try' | 'preview'
  onFirst(): void
  onPrevious(): void
  onBackFive(): void
  onNext(): void
  onForwardFive(): void
  onLast(): void
  onEnableTryMode(): void
  onEnablePreviewMode(): void
  onExitTryMode(): void
}

export function NavigationControls(props: NavigationControlsProps) {
  return (
    <nav className="navigation-controls">
      <button aria-label="First move" onClick={props.onFirst}>
        |&lt;
      </button>
      <button aria-label="Back 5 moves" onClick={props.onBackFive}>
        &lt;&lt;
      </button>
      <button aria-label="Previous move" onClick={props.onPrevious}>
        &lt;
      </button>
      <span className={`move-number-stone ${moveStoneClass(props.toPlay)}`} aria-label={moveStoneLabel(props.moveNumber, props.toPlay)}>
        {props.moveNumber}
      </span>
      <button aria-label="Next move" onClick={props.onNext}>
        &gt;
      </button>
      <button aria-label="Forward 5 moves" onClick={props.onForwardFive}>
        &gt;&gt;
      </button>
      <button aria-label="Last move" onClick={props.onLast}>
        &gt;|
      </button>
      {props.canBackToMain && (
        <button className="try-action-button try-action-exit" aria-label="Exit try mode" onClick={props.onExitTryMode}>
          退
        </button>
      )}
      {!props.canBackToMain && props.interactionMode === 'try' && (
        <button className="try-action-button try-action-ready" aria-label="Switch to AI preview mode" aria-pressed="false" onClick={props.onEnablePreviewMode}>
          试
        </button>
      )}
      {!props.canBackToMain && props.interactionMode === 'preview' && (
        <button className="try-action-button try-action-preview" aria-label="Enable direct try mode" aria-pressed="true" onClick={props.onEnableTryMode}>
          试
        </button>
      )}
    </nav>
  )
}

function moveStoneClass(toPlay?: Color) {
  if (!toPlay) return 'move-number-stone-empty'
  return toPlay === 'B' ? 'move-number-stone-black' : 'move-number-stone-white'
}

function moveStoneLabel(moveNumber: number, toPlay?: Color) {
  if (!toPlay) return `Move ${moveNumber}, next player unavailable`
  return `Move ${moveNumber}, ${toPlay === 'B' ? 'black' : 'white'} to play`
}
