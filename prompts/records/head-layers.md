# Head + Face Breakout Sheet Prompts (V1)

Sheets for regenerating the `headBase` / face-feature / hair layer family in one
image-to-image pass. Layout is a uniform **6-column x 3-row** grid: the assembled
head occupies the merged left 2 columns, and the 12 breakout cells fill the right
4 columns so the sheet can be sliced on straight lines with no per-cell hunting.

Input images to attach, in order:

1. `Diagnostics/male-head-attachments-v1.png` (or `female-head-attachments-v1.png`)
   as the part-inventory and identity reference.
2. `Concepts/hunter-male-three-quarter-selected-v1.png` (or
   `Concepts/hunter-female-three-quarter-family-v1.png`) as the style, palette,
   lighting, and three-quarter-orientation reference.

Facing note: the head is turned toward screen-left, so the character's
anatomical-LEFT side is the NEAR side (screen-right of the face, where the scar
sits) and the anatomical-RIGHT side is the FAR side.

Outputs are chroma sheets. Run the imagegen `remove_chroma_key.py` helper to get
transparent PNGs, then re-cut against `face-customization-v1.json` slot names.

## Male head + face breakout sheet

```text
Use case: precise-object-edit
Asset type: modular 2D character head, face-feature, and hair attachment sheet for a 2D skeletal rig
Input images: Image 1 is the exact identity, part inventory, and style reference for the male hunter head; Image 2 is the full-character style, palette, lighting, and three-quarter orientation reference.
Primary request: Produce one single flat sheet containing the assembled male hunter head plus every face and hair attachment drawn as a separate isolated piece, all in the same three-quarter facing, scale family, and painting style as Image 1.
Layout: Divide the square canvas into a strict uniform grid of 6 equal columns by 3 equal rows with identical cell sizes and identical gutters. Columns 1 and 2 are merged across all 3 rows into one tall left panel that contains only the assembled head. Columns 3 through 6 form a 4-column by 3-row block of 12 equal breakout cells on the right. Every piece is centered inside its own cell, fully inside the cell bounds, never touching a cell edge, never overlapping a neighbor, and never crossing a gutter. Keep all grid lines perfectly straight, axis-aligned, and evenly spaced so the sheet can be sliced arithmetically.
Left panel: the fully assembled male head at the largest size that fits with padding: bald head base plus eyes, brows, nose, neutral mouth, cheek scar, back hair and front hair combined, and the open neck stump. This is the reference assembly only.
Breakout cells, strictly in this order, left to right then top to bottom:
Row 1: (1) headBase - bald head silhouette with a complete painted scalp, both ears baked in, and an open flat neck stump, with no eyes, brows, nose, mouth, scar, or hair; (2) hairBack - the rear hair mass that draws behind the head, alone; (3) hairFront - the fringe, top, and side locks that draw over the face and scalp, alone; (4) faceMarkScar - the four-point cheek star scar, alone.
Row 2: (5) eyeL - the character's anatomical-left eye, the NEAR eye, with its upper lid shadow; (6) eyeR - the anatomical-right eye, the FAR eye, narrowed by the three-quarter perspective; (7) browL - the near heavy angular brow; (8) browR - the far heavy angular brow.
Row 3: (9) nose - the three-quarter nose wedge with its underside shadow; (10) mouthNeutral - the firm closed neutral mouth; (11) mouthGrit - the same mouth identity in a clenched, teeth-showing grit expression; (12) neckBase - the neck cylinder and trapezius cap that tucks under the head and shirt.
Rig construction: Every breakout piece must be a self-contained attachment that can be layered onto headBase without repainting it. Give each feature a small amount of hidden overlap into the surrounding skin so it can be nudged a few pixels without exposing a seam. Do not paint any feature onto the bald headBase. Do not paint hair onto the scalp of headBase. Do not paint the scar on any piece other than cell 4. Keep the relative scale of every part consistent with the assembled head in the left panel so pieces can be composited at 1:1.
Style/medium: Match Image 1 exactly - stylized hand-painted fantasy game sprite art, heavy black outline, warm tan skin, dark brown hair, dark brown irises, stern heroic expression, single upper-left key light with warm bounce, no rendering style change between the assembled head and the parts.
Background: perfectly flat solid #ff00ff magenta everywhere, including inside the gutters and behind every piece.
Constraints: Exactly one assembled head and exactly twelve breakout pieces, thirteen objects total. No labels, captions, numbers, arrows, guides, or grid lines drawn into the art. No duplicate parts, no extra parts, no partial head fragments other than those listed.
Avoid: features baked into headBase, hair painted on the scalp, pieces overlapping cell boundaries, uneven cell sizes, cropped or clipped pieces, drop shadows, gradients, scenery, watermark, text, magenta bleeding into the skin or hair, changed facial identity, changed skin or hair color, front-facing or profile head angles.
```

## Female head + face breakout sheet

```text
Use case: precise-object-edit
Asset type: modular 2D character head, face-feature, and hair attachment sheet for a 2D skeletal rig
Input images: Image 1 is the exact identity, part inventory, and style reference for the female hunter head; Image 2 is the full-character style, palette, lighting, and three-quarter orientation reference.
Primary request: Produce one single flat sheet containing the assembled female hunter head plus every face and hair attachment drawn as a separate isolated piece, all in the same three-quarter facing, scale family, and painting style as Image 1.
Layout: Divide the square canvas into a strict uniform grid of 6 equal columns by 3 equal rows with identical cell sizes and identical gutters. Columns 1 and 2 are merged across all 3 rows into one tall left panel that contains only the assembled head. Columns 3 through 6 form a 4-column by 3-row block of 12 equal breakout cells on the right. Every piece is centered inside its own cell, fully inside the cell bounds, never touching a cell edge, never overlapping a neighbor, and never crossing a gutter. Keep all grid lines perfectly straight, axis-aligned, and evenly spaced so the sheet can be sliced arithmetically.
Left panel: the fully assembled female head at the largest size that fits with padding: bald head base plus eyes, brows, nose, neutral mouth, cheek scar, back hair and front hair combined, and the open neck stump. This is the reference assembly only.
Breakout cells, strictly in this order, left to right then top to bottom:
Row 1: (1) headBase - bald tapered female head silhouette with a complete painted scalp, both ears baked in, and an open flat neck stump, with no eyes, brows, nose, mouth, scar, or hair; (2) hairBack - the tied-back ponytail mass that draws behind the head, alone; (3) hairFront - the swept fringe and side locks that draw over the face and scalp, alone; (4) faceMarkScar - the four-point cheek star scar, alone.
Row 2: (5) eyeL - the character's anatomical-left eye, the NEAR eye, with its upper lid shadow; (6) eyeR - the anatomical-right eye, the FAR eye, narrowed by the three-quarter perspective; (7) browL - the near angular brow; (8) browR - the far angular brow.
Row 3: (9) nose - the three-quarter nose wedge with its underside shadow; (10) mouthNeutral - the firm closed neutral mouth; (11) mouthGrit - the same mouth identity in a clenched, teeth-showing grit expression; (12) neckBase - the slimmer neck cylinder and shoulder cap that tucks under the head and shirt.
Rig construction: Every breakout piece must be a self-contained attachment that can be layered onto headBase without repainting it. Give each feature a small amount of hidden overlap into the surrounding skin so it can be nudged a few pixels without exposing a seam. Do not paint any feature onto the bald headBase. Do not paint hair onto the scalp of headBase. Do not paint the scar on any piece other than cell 4. Keep the relative scale of every part consistent with the assembled head in the left panel so pieces can be composited at 1:1.
Style/medium: Match Image 1 exactly - stylized hand-painted fantasy game sprite art, heavy black outline, warm tan skin, dark brown hair, dark brown irises, stern determined non-sexualized expression, slimmer jaw and tapered skull, single upper-left key light with warm bounce, no rendering style change between the assembled head and the parts.
Background: perfectly flat solid #ff00ff magenta everywhere, including inside the gutters and behind every piece.
Constraints: Exactly one assembled head and exactly twelve breakout pieces, thirteen objects total. No labels, captions, numbers, arrows, guides, or grid lines drawn into the art. No duplicate parts, no extra parts, no partial head fragments other than those listed.
Avoid: features baked into headBase, hair painted on the scalp, pieces overlapping cell boundaries, uneven cell sizes, cropped or clipped pieces, drop shadows, gradients, scenery, watermark, text, magenta bleeding into the skin or hair, changed facial identity, glamour or beauty-shot styling, front-facing or profile head angles.
```

## Slicing

With a square output of side `S`, cell width is `S/6` and cell height `S/3`.
Breakout cell `(row r, col c)` for `r` in `0..2` and `c` in `0..3` occupies
`x = (2 + c) * S/6`, `y = r * S/3`. The assembled head is the region
`x in [0, S/3)`, full height, and is reference only - it is never a runtime part.

## Short variants (for input-length limits)

Use these when the generator rejects the full prompts above. Same layout and
same cell order; the omitted detail is redundancy, not requirements.

### Male (short)

```text
Edit target: Image 1 is the male hunter head identity and part reference. Image 2 is the style/lighting/three-quarter reference.
Make one sheet on a flat solid #ff00ff background, square canvas, strict uniform 6-column by 3-row grid, equal cells and gutters.
Left: columns 1-2 merged over all 3 rows, containing only the fully assembled head (bald base, eyes, brows, nose, neutral mouth, cheek scar, front and back hair, open neck stump).
Right: columns 3-6 form 12 equal cells, one isolated piece each, centered, never touching a cell edge or a neighbor, in this order:
Row 1: headBase (bald, full scalp, ears baked in, flat open neck stump, no features and no hair), hairBack, hairFront, cheek scar.
Row 2: eyeL (near, anatomical left), eyeR (far), browL (near), browR (far).
Row 3: nose, mouth neutral, mouth grit, neckBase.
Parts must layer onto headBase without repainting it, at 1:1 scale with the assembled head, each with slight hidden overlap into surrounding skin. Nothing baked into headBase.
Style: match Image 1 exactly - hand-painted fantasy sprite art, heavy black outline, warm tan skin, dark brown hair, stern expression, upper-left key light.
No labels, text, grid lines, shadows, gradients, scenery, extra or duplicate pieces, cropped pieces, or front/profile head angles.
```

### Female (short)

```text
Edit target: Image 1 is the female hunter head identity and part reference. Image 2 is the style/lighting/three-quarter reference.
Make one sheet on a flat solid #ff00ff background, square canvas, strict uniform 6-column by 3-row grid, equal cells and gutters.
Left: columns 1-2 merged over all 3 rows, containing only the fully assembled head (bald base, eyes, brows, nose, neutral mouth, cheek scar, front and back hair, open neck stump).
Right: columns 3-6 form 12 equal cells, one isolated piece each, centered, never touching a cell edge or a neighbor, in this order:
Row 1: headBase (bald tapered skull, full scalp, ears baked in, flat open neck stump, no features and no hair), hairBack ponytail, hairFront swept fringe, cheek scar.
Row 2: eyeL (near, anatomical left), eyeR (far), browL (near), browR (far).
Row 3: nose, mouth neutral, mouth grit, neckBase.
Parts must layer onto headBase without repainting it, at 1:1 scale with the assembled head, each with slight hidden overlap into surrounding skin. Nothing baked into headBase.
Style: match Image 1 exactly - hand-painted fantasy sprite art, heavy black outline, warm tan skin, dark brown hair, slimmer jaw, stern determined non-sexualized expression, upper-left key light.
No labels, text, grid lines, shadows, gradients, scenery, extra or duplicate pieces, cropped pieces, glamour styling, or front/profile head angles.
```

### Minimal fallback (either profile)

```text
From Image 1, make a #ff00ff-background sheet on a square canvas, uniform 6x3 grid. Left 2 columns merged: the assembled three-quarter hunter head. Right 4 columns x 3 rows, 12 equal cells, one isolated part each, centered and non-overlapping: headBase (bald, full scalp, ears, open neck stump, no features/hair), hairBack, hairFront, cheek scar; eyeL near, eyeR far, browL near, browR far; nose, mouth neutral, mouth grit, neckBase. Same style, palette, lighting, and scale as Image 1. Parts layer onto headBase without repainting it. No text, labels, grid lines, shadows, or extra pieces.
```

## Accepted output

The female sheet was generated from the short prompt above and is kept at
`Layers/SourceSheets/female-head-layers-v2-chroma.png`. The model laid it out as
one assembled head in the top-left quadrant plus 12 painted grid cells rather
than the requested merged 6x3 grid, so the cell rectangles are hard-coded in
`Scripts/build_female_head_layers_v2.py`, which keys the magenta out, erases the
painted grid strokes, and trims each part into `Layers/Head/femaleV1/*V2.png`.

Two things to fix in the next generation pass:

- The eye cells omit the upper-lid crease shadow that the assembled head has, so
  the brow has to sit clear of the lid or the eye reads flat.
- The standalone `headBase` skull is longer and narrower than the head painted in
  the assembled panel, so hair and face placement need editor tuning rather than
  a direct transfer of the reference layout.
