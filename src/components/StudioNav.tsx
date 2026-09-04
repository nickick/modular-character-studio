/** The route switcher shared by both authoring studios. */
import { Link } from "@tanstack/react-router"
import { useState } from "react"

export const STUDIOS = [
  {
    to: "/rig",
    title: "Rig Studio",
    blurb: "Pose the modular character, edit layers, tune deformation, and preview animations",
  },
  {
    to: "/equipment",
    title: "Equipment Studio",
    blurb: "Fit armor, weapons, shields, and accessories against the shared character rig",
  },
] as const

export function StudioNav({ current }: { current: string }) {
  const [open, setOpen] = useState(false)
  return (
    <nav className="editor-nav">
      <button
        type="button"
        className="editor-nav__button"
        aria-expanded={open}
        aria-label="Switch studio"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="editor-nav__icon" />
      </button>
      {open ? (
        <ul className="editor-nav__menu">
          {STUDIOS.map((studio) => (
            <li key={studio.to} aria-current={studio.to === current ? "page" : undefined}>
              <Link to={studio.to} onClick={() => setOpen(false)}>
                <strong>{studio.title}</strong>
                <span>{studio.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  )
}
