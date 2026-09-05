/** A searchable choice list with keyboard navigation anchored to its field. */
import { useEffect, useId, useRef, useState } from "react"
import { Popover } from "radix-ui"
import { Check, ChevronDown } from "lucide-react"
import { Label } from "@/components/ui/label.tsx"
import type { SelectFieldProps } from "./SelectField.tsx"
import "@/styles/picker-filters.css"

export function FilterSelectField({ id, label, value, options, onChange, disabled, menuSide }: SelectFieldProps) {
  const generated = useId()
  const controlID = id ?? generated
  const listID = `${controlID}-options`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const words = query.trim().toLowerCase().split(/\s+/)
  const filtered = options.filter((option) => words.every((word) => option.label.toLowerCase().includes(word)))
  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" })
  }, [active, query])

  return (
    <div className="field">
      <Label htmlFor={controlID}>{label}</Label>
      <Popover.Root open={open} onOpenChange={(next) => {
        setOpen(next)
        if (next) { setQuery(""); setActive(0) }
      }}>
        <Popover.Trigger asChild>
          <button id={controlID} type="button" data-slot="select-trigger" disabled={disabled} className="filter-select-trigger">
            <span>{options.find((option) => option.id === value)?.label ?? label}</span>
            <ChevronDown aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="filter-select-menu"
            side={menuSide}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label={`Choose ${label.toLowerCase()}`}
            onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus() }}
          >
            <div className="picker-filter">
              <input
                ref={input}
                type="search"
                role="combobox"
                aria-label={`Filter ${label.toLowerCase()}s`}
                aria-expanded={open}
                aria-controls={listID}
                aria-autocomplete="list"
                aria-activedescendant={filtered[active] ? `${listID}-${active}` : undefined}
                placeholder={`Filter ${label.toLowerCase()}s…`}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault()
                    setActive((current) => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))))
                  } else if (event.key === "Enter") {
                    event.preventDefault()
                    if (filtered[active]) pick(filtered[active].id)
                  }
                }}
              />
            </div>
            <div ref={list} id={listID} role="listbox" aria-label={label} className="filter-select-options">
              {filtered.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listID}-${index}`}
                  type="button"
                  role="option"
                  data-slot="select-item"
                  data-active={index === active}
                  aria-selected={option.id === value}
                  tabIndex={-1}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(option.id)}
                >
                  <span>{option.label}</span>
                  {option.id === value && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
            {filtered.length === 0 && <p className="picker-no-results" role="status">No matching tracks.</p>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
