# ModularCharacter Swift package

The MIT `ModularCharacter` library loads exported character data and renders its
baked animation geometry using CoreGraphics. The root `Package.swift` supports
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

For a custom arena or existing UIKit renderer, use the same renderer directly:

```swift
library.draw(in: context, animation: "run", phase: phase,
             at: feetPosition, scale: 0.36, facing: .right)
```

The context uses UIKit's Y-down coordinates. `at` is the feet/baseline position;
scale is relative to the authored pixel coordinates. This is the API used by
`PlateDemo.swift` to share a canvas with the training target and arrows.
`CharacterLibrary` also exposes `canvasSize`, `baseline`, `profile`, and
`equipmentIDs`. `init(directory:)` supports a runtime directory outside an app
bundle. Load and draw on the main thread; reuse the library rather than decoding
the JSON on each frame. A library can be shared by several character views.

## Scope and validation

The package owns loading, format/reference validation, frame sampling, rigid
transforms, triangle deformation, image-strip rendering, masks, and facing.
It contains no gameplay, action bar, inventory, or movement controller.
The demo owns those rules and imports the package for all character rendering.

The current exporter selects one plate-related loadout and eleven clips.
Sword/bow switching uses baked attachment visibility. Arbitrary equipment
changes require a new export/library; the package does not yet solve raw bones,
aim IK, or rebind new equipment on the device. `rig.json` and the bone pose
library are included for future/native solver integrations, but this renderer
consumes `runtime.json`, clip geometry, and textures. These limits do not prevent
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
