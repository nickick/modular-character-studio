/** A labelled checkbox, in the studios' stage-toolbar style. */
import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox.tsx"
import { Label } from "@/components/ui/label.tsx"

export interface ToggleProps {
  id?: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ id, label, checked, onChange, disabled = false }: ToggleProps) {
  const generated = useId()
  const controlID = id ?? generated
  return (
    <div className="check">
      <Checkbox
        id={controlID}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <Label htmlFor={controlID}>{label}</Label>
    </div>
  )
}
