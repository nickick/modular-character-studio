/**
 * The studios' slider-plus-exact-value control.
 *
 * Every authored rig value uses it: wrist, grip, finger, mesh, layer, and bone
 * adjustments. Changing either half updates the same underlying value and
 * produces one undo transaction per drag or typed edit -- `onBegin` fires when
 * an interaction starts and `onEnd` when it settles, so the caller can snapshot
 * once rather than per animation frame.
 */
import { useId } from "react"
import { Input } from "@/components/ui/input.tsx"
import { Label } from "@/components/ui/label.tsx"
import { Slider } from "@/components/ui/slider.tsx"

export interface NumericFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  /** Called once when a drag or edit begins, for a single undo transaction. */
  onBegin?: () => void
  /** Called once when the interaction settles. */
  onEnd?: () => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** Shown after the label, e.g. a key count. */
  suffix?: string
}

const finite = (value: string, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * The slider tracks the value even when it has been typed past the nominal
 * range, so an out-of-range value stays draggable instead of pinning the thumb
 * to one end.
 */
function sliderBounds(min: number, max: number, value: number): { min: number; max: number } {
  const reach = Math.max(Math.abs(min), Math.abs(max), Math.abs(value))
  return { min: min < 0 ? -reach : Math.min(min, value), max: Math.max(max, reach) }
}

export function NumericField({
  label,
  value,
  onChange,
  onBegin,
  onEnd,
  min = -100,
  max = 100,
  step = 1,
  disabled = false,
  suffix,
}: NumericFieldProps) {
  const id = useId()
  const bounds = sliderBounds(min, max, value)
  return (
    <div className="numeric-control">
      <Label htmlFor={`${id}-number`}>
        {label}
        {suffix ? <em className="numeric-control-suffix"> {suffix}</em> : null}
      </Label>
      <span className="numeric-control-fields">
        <Slider
          className="numeric-control-slider"
          aria-label={`${label} slider`}
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={[value]}
          disabled={disabled}
          onPointerDown={onBegin}
          onValueChange={([next]) => onChange(next)}
          onValueCommit={onEnd}
          onBlur={onEnd}
        />
        <Input
          id={`${id}-number`}
          className="numeric-control-number"
          type="number"
          aria-label={`${label} exact value`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onFocus={onBegin}
          onChange={(event) => onChange(finite(event.target.value, value))}
          onBlur={onEnd}
        />
      </span>
    </div>
  )
}
