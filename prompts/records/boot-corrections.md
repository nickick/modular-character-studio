# Boot progression sheet edits

Built-in ImageGen edits run through `codex exec` on 2026-09-03. Each line's
`<line>-progression-chroma.png` was the edit target and
`Layers/SourceSheets/bronze-bulwark-boots-four-piece-v1-chroma.png` the
closed-construction reference. Output is `<line>-progression-v2-chroma.png`,
keyed to `<line>-progression-v2.png` with the imagegen skill's
`remove_chroma_key.py` (border auto-key, soft matte, despill, 1px edge
contract).

## Closed-top and closed-ankle correction

Use case: precise-object-edit

Asset type: production 6-column by 4-row boot component sheet for a 2D cutout skeletal game character rig. Rows 1 and 3 are lower-leg shaft pieces, rows 2 and 4 are foot pieces.

Image 1: edit target, the <line> boot progression sheet. Image 2: style reference only, a finished four-piece boot sheet whose shafts and feet already have the closed construction wanted here. Do not copy Image 2's design, colors, or layout.

Primary request: Edit Image 1. Keep all 24 pieces in their exact cell positions, at the same size and width, with the same materials, colors, straps, plates, gems, buckles, runes, glow accents, thick dark outlines, warm upper-left lighting, and the same perfectly flat uniform green background. Change only the two things below, on every piece.

1. Shaft pieces (rows 1 and 3): remove the visible top opening. Each shaft top currently shows a dark hollow ring, an inner tube wall, or a filled-in oval cap that reads like a socket. Redraw the top so the shaft's own leather, cloth, or armor simply continues upward and ends in a clean straight closed top edge, like a greave or boot cuff that rides up over the knee, exactly as the shafts in Image 2 do. No hollow, no dark oval, no inner lining, no disc, no rim ring, no visible top surface. The shaft may extend a little taller within its own cell but must not touch or cross into any other piece. Keep the bottom of each shaft closed as well, with no hollow ankle opening.

2. Foot pieces (rows 2 and 4): remove the black or filled-in ankle hole at the top of every foot. Replace it with a short solid closed ankle tongue or collar made of that boot's own material, as the feet in Image 2 have, so nothing reads as an opening, dark oval, cavity, or disc. Keep the toe, vamp, laces, straps, outsole, and heel unchanged.

Constraints: exactly 24 isolated pieces, same grid, no pieces touching or overlapping, keep the background unchanged as flat uniform #00ff00 with no shadows, gradient, or floor, no text, labels, borders, or cell dividers, no legs, skin, people, or new objects, and no green inside any piece.

Avoid: hollow openings, black sockets, oval caps, insert holes, inner tube walls, filled discs, mirrored or re-posed pieces, style drift, changed tier order, moved pieces.
