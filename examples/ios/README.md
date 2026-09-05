# Vanguard iOS slice

Open `PlateDemo.xcodeproj`, choose an iPhone simulator, and Run. For a device,
select your own signing team in the target's Signing & Capabilities settings.
Requires Xcode with the iOS 17 SDK or newer. The generated app links the local
`ModularCharacter` Swift package included in the export; no game checkout or
remote dependency download is needed.

`PlateDemo.swift` contains the app entry point, SwiftUI action bar, and training
simulation. It imports `ModularCharacter` for bundle loading, animation sampling,
and CoreGraphics mesh rendering. The package also provides a reusable
`ModularCharacterView` for embedding a character in another SwiftUI app.

For your own app, add the repository as a Swift package (or the exported local
`ModularCharacter` folder), select its library product, and add `CharacterRuntime`
as a **folder reference** to the app target. Its nested paths must survive in
the bundle. See the package's `README.md` in the generated export, or
`docs/swift-runtime.md` in the source repository, for API examples and limits.

## Play

- Touch anywhere in the arena to place a joystick, then drag left or right to
  move and turn. Vertical drag is ignored. Release to stop and hide the joystick.
- In Sword mode, tap Attack within reach of the training target.
- Hold the shield button to preview guarding, including while moving.
- Switch to Bow; hold the same attack pad to draw, then release to shoot.
- Drag across the attack pad to face left/right; drag up off it to cancel.
- Tap Dodge to preview the dodge animation. Reset restores the starting pose
  and position. There are no health bars, scores, or game-over states.

All other gear is fixed: Vanguard Plate, Vanguard Helm, Plate Guards, Plate
Sabatons, Simple Pendant, and Simple Ring. Weapons/accessories use the closest
bundled choices: Arming Sword, Round Shield, Hunting Bow, and Leather Quiver.
Sword and shield are hidden during bow clips; the quiver stays equipped.

See [BAKING.md](BAKING.md) for the full edit → save → bake → package → iOS
build walkthrough, formats, interpolation rules, and validation.

## Regenerate from the editor

From the Modular Character Studio repository:

```sh
npm run export:ios
# Optional alternate body profile or project with the same demo item IDs:
npm run export:ios -- --profile femaleV1 --output output/ios-plate-female
```

The exporter reads saved `project/scene.json` (or `MCS_PROJECT_ROOT` / `--project`),
selects the demo loadout, and evaluates the shared TypeScript rig core at 30 Hz.
It exports the fitted skeleton/layers to `CharacterRuntime/rig.json`, the loadout,
texture and attachment catalogue to `CharacterRuntime/runtime.json`, and sampled
geometry to `CharacterRuntime/clips/*.json`. Textures retain their original dimensions,
so pivots, finger masks, wrist/elbow/ankle cages, and equipment registration stay
in the authored coordinate system. Swift interpolates the solved geometry
between samples and applies world movement/facing at runtime.

This follows Den Hunter's data-baking and CoreGraphics triangle rendering
approach, with the shared attack-pad/mode/block/dodge layout as its UI template.
It is a deliberately small horizontal training arena: it has no game campaign,
free-angle bow IK, inventory system, or spell combat. Projectile impacts provide
simple target feedback; movement and action transitions are local demo rules.
To change equipment or authored animation, edit the project and re-export;
editing the generated output is temporary and the next export overwrites it.

Code is MIT licensed. Included art is CC0; see `CharacterRuntime/CC0-1.0.txt`.
