# MCS iOS demo

The app appears as **MCS** on the Home Screen with the bundled gold character icon.
The project and bundle identifier retain their original PlateDemo names so existing
installs and build commands continue to work. The icon is included in every export
as `Assets.xcassets/AppIcon.appiconset` and is CC0 like the character artwork.

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
- Switch to Bow; the attack pad becomes a combined radial Draw / Fire dial.
  Hold it to draw, drag around its center to aim, then release to shoot.
  The outer ring shows draw progress; touching the center preserves the current aim.
  The rear finger gap pulls the arrow and original textured string back together;
  the limbs flex while the grip stays stable. The string draws above the helmet;
  the hands cover the string and arrow. A resting pull keeps the string at the finger gap.
  Wrists are limited to ±30° from neutral, or ±5° for the bow-holding wrist.
- Firing straightens the limbs/string immediately and leaves the rear hand at
  its release pose for 0.1 s. It then reaches the string as the bow arm bends,
  before the bow arm extends and both hands settle into the nocked resting pose.
  Reaching the string takes 1 s from release, then resetting takes another 1 s
  (2 s total recovery).
  Another shot can start afterward. The bow keeps its size throughout the motion.
- In Bow mode, the same held gesture aims in any direction while drawing. Both
  arms follow the aim, and arrows leave above the bow hand along the displayed guide.
- In Sword mode, drag across the attack pad to face left/right. Drag up off the
  attack pad in Sword mode to cancel. Upward drags on the bow dial aim upward.
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
between samples and applies world movement/facing at runtime. Bow clips also
export sampled bone matrices and cage bind data for on-device two-arm aim IK.

This follows Den Hunter's data-baking and asynchronous Canvas triangle rendering
approach, with the shared attack-pad/mode/block/dodge layout as its UI template.
It is a deliberately small horizontal training arena: it has no game campaign,
inventory system or spell combat. It includes free-angle bow IK and a radial aim
dial. Display-synchronized playback targets 60 Hz, with short melee clip blends;
use an optimized Release build when comparing performance. Projectile impacts provide
simple target feedback; movement and action transitions are local demo rules.
To change equipment or authored animation, edit the project and re-export;
editing the generated output is temporary and the next export overwrites it.

Code is MIT licensed. Included art is CC0; see `CharacterRuntime/CC0-1.0.txt`.
