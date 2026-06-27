import type { Color } from '../api/types'

interface NavigationControlsProps {
  moveNumber: number
  totalMoves: number
  toPlay?: Color
  canBackToMain: boolean
  tryMode: boolean
  onFirst(): void
  onPrevious(): void
  onBackFive(): void
  onNext(): void
  onForwardFive(): void
  onLast(): void
  onEnterTryMode(): void
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
      {(props.tryMode || props.canBackToMain) && (
        <button aria-label="Exit try mode" onClick={props.onExitTryMode}>
          <span className="wide-label">退出试下</span>
          <span className="narrow-label">退出</span>
        </button>
      )}
      {!props.tryMode && !props.canBackToMain && (
        <button aria-label="Try selected recommendation" onClick={props.onEnterTryMode}>
          试下
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
