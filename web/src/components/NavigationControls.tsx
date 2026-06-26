interface NavigationControlsProps {
  moveNumber: number
  totalMoves: number
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
        -5
      </button>
      <button aria-label="Previous move" onClick={props.onPrevious}>
        &lt;
      </button>
      <span>
        {props.moveNumber} / {props.totalMoves}
      </span>
      <button aria-label="Next move" onClick={props.onNext}>
        &gt;
      </button>
      <button aria-label="Forward 5 moves" onClick={props.onForwardFive}>
        +5
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
