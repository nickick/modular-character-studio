# TODO: v0.1 public release

Position Modular Character Studio as an approachable, local-first starter kit
for modular RPG characters: an MIT editor and runtime, CC0 starter art, equipment
fitting across body profiles, and a documented path into an iOS client.

Release demo: **Add your own boots or weapon, fit it, and see it working across
animations on an iPhone.**

Unchecked items are planned work. Checked items identify implementation already
present; they do not imply that the remaining release checks have passed.
Complete the workflow and release checks before changing repository visibility.

## 1. Elbow deformation

- [x] Extend the joint-mesh editor and scene validation to both elbows.
  Present in the editor sync through `be25546`, with upper-arm and forearm cages
  on both sides in the bundled scene.
- [ ] Review and tune elbow cages for the bundled arms and applicable armor pieces on
  both body profiles, including both sides of the joint where needed.
- [ ] Check straight, bent, and extreme poses during sword, axe, staff, and bow
  animations; verify the joints do not develop gaps or collapse.
- [ ] Preserve authored cages through save, reload, export, and runtime playback.

## 2. Portable runtime export

- [ ] Extract the animation baker and resource packager from the main app into
  a standalone export command, with an Export Runtime action in the editor.
- [ ] Define and document a versioned bundle containing the scene, baked
  animation tracks, equipment options, expressions, and referenced images.
- [ ] Include authored bone, wrist/grip, and expression corrections so exported
  playback matches the editor.
- [ ] Preserve pivots, original image dimensions, crop offsets, and mesh
  coordinates when cropping or resizing runtime images.
- [ ] Validate references and format compatibility; report actionable errors
  for missing assets or unsupported data.
- [ ] Ensure exporting works from this repository alone, without a checkout of
  the main game or machine-specific paths.

## 3. Swift package and iOS demo

- [ ] Extract the existing Swift renderer and pose solver into an MIT Swift
  package without dependencies on the main game's inventory or gameplay code.
- [ ] Provide a reusable `ModularCharacterView` that loads the exported bundle.
- [ ] Include a small Xcode demo with body, equipment, and animation selectors,
  play/pause, and timeline scrubbing.
- [ ] Support the exported wrist, ankle, and elbow deformation plus equipment
  placement, grip behavior, expressions, and attachment visibility.
- [ ] Verify matching browser/iOS poses at matching timestamps, including helmet
  hair hiding and bow animations hiding incompatible weapons.
- [ ] Run the demo on a physical iPhone and record frame timing and memory use
  for the sample character; document tested devices and known limitations.

## 4. Documentation and first-run experience

- [ ] Document the complete path: edit -> save -> export runtime bundle -> add
  bundle to the iOS demo -> run.
- [ ] Add a tutorial for importing and fitting a new boot or weapon, including
  asset naming, crop bounds, pivots, profile-specific transforms, and meshes.
- [ ] Show an authored placement or cage change reaching the iOS demo through
  re-export, with no manual recreation of the fit on the client.
- [ ] Document the project format, runtime API, supported features, and limits.
- [ ] Record a short editor/iPhone demonstration and add it to the README.
- [ ] Explain the MIT code / CC0 bundled-art split and link the included prompts
  and generated-image gallery.

## 5. Release rehearsal

- [ ] From a fresh clone, install, start, edit, save, reopen, export, and run the
  demo using only the published instructions and included resources.
- [ ] Verify every bundled equipment option on both body profiles, including
  selection persistence, fitted placements, crop bounds, and joint seams.
- [ ] Ensure CI covers project validation, web checks/build, export validation,
  and the extracted Swift package with meaningful runtime checks.
- [ ] Review tracked files and Git history for unintended private content,
  credentials, unrelated game assets, and machine-specific paths.
- [ ] Check license notices and provenance for all bundled code and art.
- [ ] Once the release is ready and publication is approved, make the repository
  public and tag v0.1 with release notes and known limitations.

## Positioning and existing tools

Skeletal animation, modular equipment, mesh deformation, and iOS playback already
exist elsewhere. Describe the value of this project's focused workflow and
complete starter kit; do not claim these individual features are new.

References from the initial documentation comparison (not hands-on evaluations):

- [Spine mix-and-match](https://esotericsoftware.com/spine-examples-mix-and-match)
  and [iOS runtime](https://esotericsoftware.com/spine-ios): modular skins,
  deformation, SwiftUI integration, and a dress-up demo.
  [Runtime licensing](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/README.md)
  differs from MIT.
- [Spriter Character Maps](https://www.brashmonkey.com/spriter_manual/what%20are%20character%20maps.htm):
  reusable animations with interchangeable clothing, equipment, and hidden parts.
- [DragonBones features](https://dragonbones.github.io/en/animation.html),
  [MIT JS runtime](https://github.com/DragonBones/DragonBonesJS), and
  [LoongBones online editor](https://www.loongbones.com/doc/en/): overlapping
  rigging and deformation workflows. The editor's source/license availability
  was not established by this comparison.
- [Rive meshes](https://rive.app/docs/editor/manipulating-shapes/meshes) and
  [Apple runtime](https://rive.app/docs/runtimes/apple/apple): raster deformation,
  image swapping, and an open-source runtime with SwiftUI integration.
- [COA Tools](https://github.com/ndee85/coa_tools): GPL cutout rigging, meshes,
  weights, and export/import tooling in a Blender workflow.

- [ ] Write a concise "Who this is for" section grounded in the completed
  workflow: local customization, equipment fitting, included CC0 assets, and
  a small, understandable iOS integration.
- [ ] Demonstrate how much setup the starter kit saves before making comparative
  claims about ease of use or claiming a unique feature combination.
