export interface OverlayState {
  candidates: boolean
  ownership: boolean
  deadStones: boolean
}

interface OverlayTogglesProps {
  value: OverlayState
  onChange(value: OverlayState): void
}

export function OverlayToggles({ value, onChange }: OverlayTogglesProps) {
  return (
    <div className="overlay-toggles" aria-label="Board overlays">
      <button aria-label="Toggle recommended moves" className={value.candidates ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, candidates: !value.candidates })}>
        点
      </button>
      <button aria-label="Toggle ownership" className={value.ownership ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, ownership: !value.ownership })}>
        势
      </button>
      <button aria-label="Toggle weak stones" className={value.deadStones ? 'toggle active' : 'toggle'} onClick={() => onChange({ ...value, deadStones: !value.deadStones })}>
        死
      </button>
    </div>
  )
}
