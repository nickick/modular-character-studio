# Equipment Matrix ImageGen Prompt Set

Generated 2026-09-01 with the built-in `image_gen` tool, using existing local
ThreeQuarterV1 equipment art as image references. Source sheets are retained in
`SourceSheets/`; `*-chroma.png` is the original generated sheet and the matching
`.png` is the keyed RGBA source.

## Shared rendering contract

All prompts requested polished hand-painted fantasy RPG sprites matching the
attached Goblin Hunter examples, with crisp dark outlines, readable silhouettes,
compact controlled highlights, generous padding, and a perfectly uniform flat
`#00ff00` chroma-key background. They explicitly excluded labels, text, borders,
cell dividers, shadows, scenery, people, mannequins, hands, skin, and loose extra
objects. Output was keyed with the ImageGen skill's `remove_chroma_key.py` helper
using border sampling, soft matte, edge contraction, and spill cleanup.

Six-tier sheets always read Common, Magical, Rare, Epic, Legendary, Mythic.
Progression language was fixed across every slot:

- Common: practical, worn, simple material, very low detail.
- Magical: one restrained enchanted accent.
- Rare: improved material and construction.
- Epic: intricate surface work and a stronger silhouette.
- Legendary: jeweled primary-color focal element and dense detailing.
- Mythic: exceptional silhouette with contained luminosity, never diffuse haze.

## Archetype visual ladders

- Unaligned: wayfarer brown/iron -> restrained runes on tempered steel ->
  veteran steel and navy -> champion cobalt/silver -> kingsguard royal blue,
  gold, and one sapphire -> dawnbound ivory, blue-gold, and contained white
  radiance. Versatile and heroic without borrowing a specialist motif.
- Shortbow Archer: trail brown -> swiftleaf green -> skirmish bronze -> deadeye
  dark leather -> windrunner emerald/silver -> tempest sapphire/blue-silver.
- Longbow Archer: yew -> ironwood -> warbow reinforcement -> greatbow dark steel
  -> ivory dragonbone/ruby/gold -> moonsteel silver-blue lunar arrow motifs.
- Loud Mage: hedge copper -> ember orange -> field red/blue -> intricate
  battlemage cobalt -> jeweled sapphire/topaz with gold lightning conductors ->
  cinderheart/thunderheart ruby-orange or violet-blue contained power.
- Silent Mage: whisper charcoal -> frost pale blue -> shade smoked silver -> void
  black-violet -> veil deep indigo/moon-silver -> starcaller silver and contained
  starlight. No fire bursts or loud lightning shapes.
- Power Brute: battered leather/iron -> bronze -> riveted raider steel -> thick
  blackened iron -> crimson/gold marauder with ruby -> worldbreaker black iron
  with contained molten-orange fissures. Heavy, broad, physical silhouettes.
- Sneak: stalker black -> cutthroat muted green -> moonsteel -> intricate
  near-black gloamstitch -> blackened-silver hitman with one dark ruby -> midnight
  nightfall with subtle violet edge. Low reflection and compact silhouettes.

## Slot prompt templates

### Single-layer 3x2 progression

Used for bows, weapons, shields, quivers, necklaces, headgear, and rings:

> Create a clean 3x2 sprite progression sheet on a perfectly uniform flat
> #00ff00 chroma-key background. Six isolated equipment sprites, one centered
> per equal cell, ordered Common through Mythic left-to-right top row then
> bottom row. No labels, text, borders, dividers, shadows, scenery, people, or
> extra objects. Every sprite is fully visible with padding and identical slot-
> appropriate orientation. Match the attached Goblin Hunter sprite geometry.

Slot-specific geometry appended to that template:

- Bow: upright side-on bow, centered grip; Shortbow compact, Longbow tall, Silent
  spell-channeling, Sneak dark precision recurve.
- Weapon: upright grip-down silhouette; Power axes/cleavers are top-heavy and
  brutal, Sneak daggers/rapiers are slim precision weapons.
- Shield: straight-on front face; Loud uses circular/hexagonal arcane wards,
  Power broad physical shields, Sneak compact oval/asymmetrical bucklers.
- Quiver: true 25-30 degree back-worn three-quarter view, closed container with
  visible arrow fletching; no Loud or Power variants.
- Necklace: complete broad curved collar/cord/chain in shallow three-quarter
  front view with centered pendant, shaped to drape over neck and upper chest.
- Headgear: exact true 25-30 degree three-quarter front shell. Face and cheek
  openings must show green through them; no black void/socket, face, eyes, hair,
  head, neck, or body.
- Ring: enlarged three-quarter product angle, band opening visible, bezel/signet
  facing upper-right.

### Body 6x2 progression

> Create a six-column by two-row body-clothing progression. Columns are Common
> through Mythic; top row maleV1 and bottom row femaleV1. Every garment uses the
> same true 25-30 degree ThreeQuarterV1 torso perspective and short-skirt slot
> geometry. Garment only: no head, arms, hands, legs, mannequin, black armholes,
> black sockets, or painted skin. The neck and arm openings show green through.

The Loud Legendary body direction was explicitly royal blue with sapphire and
topaz lightning elements, dense gold conductor filigree, and heavy jeweled
detailing. Sneak Epic+ was explicitly darker and more intricate.

### Articulated arms 6x4 progression

> Create a precise 6-column by 4-row component sheet. Columns are Common through
> Mythic. Rows are: left/inside upper-arm shoulder sleeve, left/inside forearm
> vambrace, right/outside upper-arm shoulder sleeve, right/outside forearm
> vambrace. Exactly 24 isolated pieces. Match the attached rig arm-unit geometry;
> upper-arm pieces are short fitted shoulder sleeves and forearm pieces are
> tapered bracers. No full arms, skin, hands, or black sockets.

### Articulated boots 6x4 progression

> Create a precise 6-column by 4-row component sheet. Columns are Common through
> Mythic. Rows are: left shaft only, left foot only with toe screen-left, right
> shaft only, right foot only with toe screen-right. Exactly 24 isolated pieces.
> Match the attached rig boot-unit geometry and three-quarter perspective. No
> legs, skin, people, or merged shaft-and-foot cells.

## One-off prompts

- `Gloamstitch Quiver`: Epic Sneak back-worn quiver, near-black leather, smoke-
  gray intricate stitching and metalwork, low reflection, true three-quarter
  slot geometry, flat green background.
- `Whisper Focus`: Common Silent Mage dark whisperwood focus rod with a tiny pale
  blue moonstone and one restrained silver binding; no fire or lightning burst.

## Reference groups

- Body: existing ThreeQuarterV1 chest overlays and male/female assembled rig.
- Bows/weapons/casting/shields: `Layers/Equipment/` examples including
  `moonsteelWarbow`, `moonsteelRapier`, brute axes, `starcallerStaff`,
  `stormglassWand`, `roundShield`, `runeboundWard`, and `veilwoodBuckler`.
- Necklaces/rings: existing files in `Layers/Accessories/Necklaces/` and
  `Layers/Accessories/Rings/`.
- Headgear: closed-cheek, frostweave, emberward, and starcaller shells.
- Arms: the four `Layers/ArmUnits/rigidV2/` inside/outside components.
- Boots: the four `Layers/BootUnits/starcallerV1/` left/right components.
