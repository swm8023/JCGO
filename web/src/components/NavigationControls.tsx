interface NavigationControlsProps {
  moveNumber: number
  totalMoves: number
  canBackToMain: boolean
  onFirst(): void
  onPrevious(): void
  onNext(): void
  onLast(): void
  onBackToMain(): void
  onPass(): void
  onDeleteVariationNode(): void
  onClearVariation(): void
}

export function NavigationControls(props: NavigationControlsProps) {
  return (
    <nav className="navigation-controls">
      <button aria-label="First move" onClick={props.onFirst}>
        |&lt;
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
      <button aria-label="Last move" onClick={props.onLast}>
        &gt;|
      </button>
      {props.canBackToMain && (
        <button aria-label="Back to main line" onClick={props.onBackToMain}>
          Main
        </button>
      )}
      <button onClick={props.onPass}>Pass</button>
      <button onClick={props.onDeleteVariationNode}>Delete node</button>
      <button onClick={props.onClearVariation}>Clear branch</button>
    </nav>
  )
}
