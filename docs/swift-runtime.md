# ModularCharacter Swift package

The MIT `ModularCharacter` library loads exported character data and renders its
baked animation geometry using asynchronous SwiftUI Canvas, with a CoreGraphics
fallback for UIKit hosts. It also solves bow aim on-device. The root `Package.swift` supports
adding this repository through Xcode's **Add Package Dependencies** or as a local
Swift package. Select the `ModularCharacter` product. Rendering requires iOS 17+;
the Foundation data and sampling tests also run on macOS 13+.

`npm run export:ios` produces a standalone Xcode demo that imports this same
library. Its `ModularCharacter/` directory contains a copy of the package sources,
tests, API documentation, and MIT license. The generated project already links
that local package; it needs no game checkout or remote package download.
For ongoing development, edit `Sources/ModularCharacter` in the source repository
and re-export. Generated copies are overwritten.

## Add a character to your own app

1. Add the package and its `ModularCharacter` product to your app target.
2. Export your saved project with `npm run export:ios`.
3. Add the exported `CharacterRuntime` directory to the app target as a folder
   reference, preserving all nested filenames in the bundle.
4. Load a `CharacterLibrary` once, retain it, and pass it to the view. Handle
   errors in your loading UI; missing files and unsupported formats throw.

```swift
import SwiftUI
import ModularCharacter

struct CharacterPreview: View {
    let library: CharacterLibrary // Created with try CharacterLibrary(bundle: .main)
    @State private var phase = 0.0

    var body: some View {
        VStack {
            ModularCharacterView(library: library, animation: "swordSwing",
                                 phase: phase, facing: .right)
                .frame(width: 320, height: 360)
            Slider(value: $phase, in: 0...1)
        }
    }
}
```

The view fits the original artboard into its bounds. Hosts own playback timing:
use `library.animations[name]?.duration` and `.loops` to convert elapsed seconds
to a normalized phase, or supply phase from a scrubber. Phase clamps to 0...1;
nonfinite input uses zero. Unknown animation names draw nothing. Attachment
changes step at their sample boundary, while matching geometry interpolates.
An unkeyed terminal frame holds the preceding sample until the exact endpoint,
matching the baker's reset rule.

For a custom arena, sample immutable geometry and draw it in an asynchronous Canvas:

```swift
let frame = library.sample(animation: "bowDraw", phase: phase,
                           bowAimPitchDegrees: -30) // negative = up, positive = down
Canvas(rendersAsynchronously: true) { context, size in
    library.draw(in: context, frame: frame,
                 at: CGPoint(x: size.width / 2, y: size.height),
                 scale: 0.36, facing: .right)
}
```

`bowAimPitchDegrees` clamps to −90...90 and preserves facing separately. Clips
carry sampled bone transforms; bow clips apply the main client's two-arm IK,
then rigid attachments and thickness-preserving wrist/elbow cages follow the
solved bones. Wrist rotation is limited to ±30° from the authored neutral bind,
tightened to ±5° on the bow-holding wrist. The arm solver places the gap between
the rear index and ring fingers at the arrow base without exceeding those limits.
`bowDraw` phase 0...1 moves that contact from rest to full draw; draw length
shortens at the edge of the arm's reach. `frame.bowNock` is the
authored-space arrow socket with clearance above the bow fist; use it for both
the guide and projectile origin. Older exports
without aim metadata retain their baked pose. Re-export to enable live aiming.
`ModularCharacterView` also accepts `bowAimPitchDegrees`.

Bow limbs flex around a stable grip. The original texture's string is masked
out of the body and drawn as two deforming textured sections meeting at the
nock, in a foreground pass above the helmet and below the hands. Each half is
straight from its limb attachment to the nock, including a slight resting pull.
No replacement string art is used. Custom arrows can use the Canvas draw call's
`bowOverlay` closure, which runs after the string and before the hands.
Straight strings are detected once when textures load; unsupported silhouettes
retain their undeformed sprite. Re-export older bundles to include wrist metadata
for every clip. These live deformations use the Canvas renderer.

`frame.blended(from:progress:)` blends matching attachment geometry for short
clip transitions. The demo uses a display link (60 Hz preferred), 120 ms melee
transitions, and cached clip durations. The 30 Hz export rate is a sampling rate,
not a playback cap. For performance comparisons, use Xcode's Release configuration.

For an existing UIKit renderer, the original CoreGraphics entry point remains:

```swift
library.draw(in: context, animation: "run", phase: phase,
             at: feetPosition, scale: 0.36, facing: .right)
```

The context uses UIKit's Y-down coordinates. `at` is the feet/baseline position;
scale is relative to the authored pixel coordinates. `PlateDemo.swift` uses the
Canvas overload to share a surface with the training target and arrows.
`CharacterLibrary` also exposes `canvasSize`, `baseline`, `profile`, and
`equipmentIDs`. `init(directory:)` supports a runtime directory outside an app
bundle. Load and sample on the main thread, and pass immutable frames to Canvas;
the CoreGraphics overload remains main-thread-only. Reuse the library rather
than decoding JSON on each frame. A library can be shared by several character views.

## Scope and validation

The package owns loading, format/reference validation, frame sampling, rigid
transforms, triangle deformation, image-strip rendering, masks, and facing.
It contains no gameplay, action bar, inventory, or movement controller.
The demo owns those rules and imports the package for all character rendering.

The current exporter selects one plate-related loadout and eleven clips.
Sword/bow switching uses baked attachment visibility. Arbitrary equipment
changes require a new export/library; the package does not yet solve arbitrary
raw pose tracks or rebind new equipment on the device. Bow aiming is a live
two-arm solver over sampled bones, not a full general-purpose rig runtime.
`rig.json` and the bone pose library remain included for future integrations;
this renderer consumes `runtime.json`, clip geometry/bone samples, and textures. These limits do not prevent
reusing the package in another iOS app.

Run `swift test` for format, geometry validation, and interpolation checks. To
also exercise real exported data:

```sh
npm run export:ios
MCS_RUNTIME_DIRECTORY="$PWD/output/ios-plate-demo/CharacterRuntime" swift test
```

CI also builds the generated iOS app and its local package on a simulator SDK.
Pixel matching against the editor and physical-device timing/memory profiling
remain release checks. See the source repository's `examples/ios/BAKING.md` for
the bake/export format and workflow; generated demos include `BAKING.md` beside
the Xcode project.
