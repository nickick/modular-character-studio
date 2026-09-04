# Facial Expression Source Sheet Prompts (V1)

Generated with the built-in image generation tool using the accepted male and
female head sheets as high-fidelity identity/style references. Each output is a
4-column by 4-row sheet on transparency, in this order:

- row 1: left blink, right blink, left wide, right wide
- row 2: left focused, right focused, left wince, right wince
- row 3: smile, smirk, shout, surprised O
- row 4: frown, pain, grit, talk vowel

## Base prompt

```text
Use case: stylized-concept
Asset type: production source sheet for a modular 2D game character rig
Primary request: Create a NEW expression-parts sprite sheet for the exact same
hunter shown in the reference. Preserve the three-quarter face identity, dark
brown eyes, strong black-brown ink contours, cel-shaded warm ochre/gold palette,
painterly fantasy-game finish, and the same screen-facing direction. Do not
redraw the head, hair, nose, scar, neck, or brows.
Scene/backdrop: genuinely transparent background.
Composition/framing: Square 4-column by 4-row production sheet. Each cell
contains exactly one isolated facial attachment centered with generous empty
padding. No cell borders, labels, guide lines, shadows outside the part, or
overlap between cells.
Required cell order:
Row 1: LEFT eye blink/closed; RIGHT eye blink/closed; LEFT eye wide/startled;
RIGHT eye wide/startled.
Row 2: LEFT eye narrowed/focused; RIGHT eye narrowed/focused; LEFT eye
wince/hurt; RIGHT eye wince/hurt.
Row 3: mouth warm small smile; mouth one-sided confident smirk; mouth open
battle shout; mouth round surprised O.
Row 4: mouth worried frown; mouth pain grimace; mouth clenched teeth grit; mouth
open speaking/talk vowel.
Details: Preserve three-quarter asymmetry and foreshortening. Eye pieces include
eyelids, iris/pupil where open, and only minimal surrounding skin. Mouth pieces
include lips/teeth/tongue only where naturally visible and minimal surrounding
skin. All parts align visually to the same face anchors as the reference.
Critical separation rule: every eye cell contains only the eye, eyelids/lashes,
and minimal adjacent skin. No separate eyebrow or brow bar. Leave transparent
space above each eye for a separately animated brow attachment.
Constraints: exact same character and rendering style; crisp antialiased edges;
actual alpha transparency; no duplicated parts, full face, head, hair, nose,
scar, text, or watermark.
```

The male pass required one precise-object edit to remove brows that had been
baked into its eye cells. Both source outputs displayed an opaque checkerboard,
so the deterministic builder removes only edge-connected bright neutral pixels,
contracts the contaminated edge by one pixel, and writes real alpha before
slicing the assets.

## Profile substitutions

- Male input: `Layers/SourceSheets/male-head-layers-v3-chroma.png`. The subject
  line specified the same young adult male hunter, angular face, and male sheet's
  anatomical-by-screen-position naming.
- Female input: `Layers/SourceSheets/female-head-layers-v2-chroma.png`. The
  subject line specified the same young adult female hunter, tapered face, and
  female sheet's anatomical-by-screen-position naming.

## Male eye-separation correction

```text
Use case: precise-object-edit
Edit only the eight eye cells in rows 1 and 2. Remove the separate thick dark
eyebrow or brow-bar shapes above every eye. Reconstruct only the eyelid and skin
underneath, preserving blink, wide, narrowed, and wince pairs. Keep thin eyelid
and lash contours touching the eye opening, but leave transparent space above
each eye for a separately animated brow attachment. Keep the 4x4 layout and all
eight mouth cells unchanged. No labels, borders, face, hair, nose, scar, text,
or watermark.
```

## Transparency request

```text
Use case: background-extraction
Remove only the light gray and white checkerboard background and replace it
with genuine alpha transparency. Preserve all 16 facial attachments in their
current positions, sizes, colors, shapes, line work, and 4x4 layout. Preserve
internal whites such as teeth and eye highlights. Do not redraw, restyle,
relayout, resize, crop, add, or remove any facial part. No border, shadow, color
fringe, halo, or watermark.
```

## Male default selection

The male `eyeLFocusedV1` and `eyeRFocusedV1` attachments are the profile's
default eyes. They are padded without stretching onto the existing standardized
eye canvases, so the editor keeps its calibrated eye anchors. The manifest's
`neutral` state aliases this same pair; blink, wide, and wince remain explicit
keyframe alternatives. The focused and wide pupils stay within the five-pixel
implied-size tolerance checked by the asset test.

## Male eye skin-color correction

```text
Use case: precise-object-edit
Edit only the surrounding skin color of the eight male eye attachments in rows
1 and 2. Match that skin to the reference male face's saturated orange-gold
midtone, warm amber highlight, and burnt-orange shadow. Remove the pale lemon
yellow cast and any yellow halo at the attachment edges. Preserve every eye's
silhouette, position, scale, eyelid geometry, gaze direction, iris, pupil,
catchlight, dark linework, three-quarter asymmetry, and transparent separation
space for the brows. Keep all eight mouth cells and the 4x4 layout unchanged.
Do not add brows, labels, borders, facial features, or a watermark.
```

## Female eye skin-color correction

```text
Use case: precise-object-edit
Edit only the surrounding skin color of the eight female eye attachments in
rows 1 and 2. Match that skin to the reference female face's saturated warm
orange-gold midtone, amber highlight, and burnt-orange shadow. Remove the pale
yellow-beige cast and any light halo visible when the pieces are composited on
the face. Preserve every eye silhouette, cell position, scale, eyelid geometry,
lash contour, gaze direction, iris, pupil, catchlight, dark linework,
three-quarter asymmetry, and checkerboard layout. Preserve the implied pupil
size. Keep all eight mouth cells unchanged. Do not add brows, labels, borders,
facial features, text, or a watermark.
```

## Face-boundary mask

The builder derives `faceFeatureMaskV1.png` from each profile's actual
`headBaseNoNeckV2.png` alpha, inset by two source pixels so animated features
cannot paint over the outer face contour. It projects that reusable mask into
the saved `eyeL`, `eyeR`, and `mouth` attachment transforms before writing every
expression PNG. This keeps all states inside the correct male or female
three-quarter silhouette without hand-cutting individual expressions.
