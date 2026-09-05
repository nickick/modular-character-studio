/** A labelled select over a list of id/label options. */
import { useId } from "react"
import { Label } from "@/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx"

export interface SelectOption {
  id: string
  label: string
}

export interface SelectFieldProps {
  id?: string
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** Shown when nothing is selected, and offered as a way back to nothing. */
  placeholder?: string
  /** Anchor menus in edge toolbars so long lists stay inside the window. */
  menuSide?: "top" | "bottom"
}

/**
 * Radix has no concept of an item with an empty value, so "no selection" is
 * carried as an explicit sentinel and mapped back to an empty string.
 */
const NONE = "__none__"

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  menuSide,
}: SelectFieldProps) {
  const generated = useId()
  const controlID = id ?? generated
  return (
    <div className="field">
      <Label htmlFor={controlID}>{label}</Label>
      <Select
        value={value === "" ? NONE : value}
        disabled={disabled}
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
      >
        <SelectTrigger id={controlID} size="sm">
          <SelectValue placeholder={placeholder ?? label} />
        </SelectTrigger>
        <SelectContent
          position={menuSide ? "popper" : "item-aligned"}
          side={menuSide}
          align={menuSide ? "start" : "center"}
          style={menuSide ? { maxHeight: "min(320px, var(--radix-select-content-available-height))" } : undefined}
        >
          {placeholder ? <SelectItem value={NONE}>{placeholder}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
