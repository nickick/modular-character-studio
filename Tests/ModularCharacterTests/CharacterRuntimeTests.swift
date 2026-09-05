import Foundation
import ImageIO
import XCTest
@testable import ModularCharacter

final class CharacterRuntimeTests: XCTestCase {
    private func animation(endKeyed: Bool = true, attachment: Int = 0) throws -> CharacterAnimation {
        let json = """
        {"duration":1,"loops":true,"endKeyed":\(endKeyed),"frames":[
          [{"attachment":0,"values":[0,0,0,0,0,0]}],
          [{"attachment":0,"values":[10,10,10,10,10,10]}],
          [{"attachment":\(attachment),"values":[20,20,20,20,20,20]}]]}
        """
        return try JSONDecoder().decode(CharacterAnimation.self, from: Data(json.utf8))
    }

    func testInterpolatesClampsAndHandlesNonfiniteInput() throws {
        let clip = try animation()
        XCTAssertEqual(clip.sample(phase: 0.25)[0].values, Array(repeating: 5, count: 6))
        XCTAssertEqual(clip.sample(phase: -1)[0].values[0], 0)
        XCTAssertEqual(clip.sample(phase: 2)[0].values[0], 20)
        XCTAssertEqual(clip.sample(phase: .nan)[0].values[0], 0)
        XCTAssertEqual(clip.sample(phase: .infinity)[0].values[0], 0)
    }

    func testUnkeyedEndpointHoldsUntilReset() throws {
        let clip = try animation(endKeyed: false)
        XCTAssertEqual(clip.sample(phase: 0.99)[0].values[0], 10)
        XCTAssertEqual(clip.sample(phase: 1)[0].values[0], 20)
    }

    func testAttachmentChangesStepInsteadOfMorphingDifferentTextures() throws {
        let clip = try animation(attachment: 1)
        XCTAssertEqual(clip.sample(phase: 0.75)[0].attachment, 0)
        XCTAssertEqual(clip.sample(phase: 0.75)[0].values[0], 10)
        XCTAssertEqual(clip.sample(phase: 1)[0].attachment, 1)
    }

    private func withBundle(_ body: (URL, inout [String: Any]) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let clip = """
        {"duration":1,"loops":true,"endKeyed":true,"frames":[
        [{"attachment":0,"values":[1,0,0,1,0,0]}],[{"attachment":0,"values":[1,0,0,1,10,0]}]]}
        """
        try Data(clip.utf8).write(to: root.appendingPathComponent("idle.json"))
        var manifest: [String: Any] = [
            "format": "modular-character-studio-ios-demo-v1", "profile": "test",
            "canvas": ["width": 20, "height": 20], "baseline": 20, "loadout": [:],
            "assets": [["path": "body.png", "width": 10, "height": 10]],
            "attachments": [["id": "body", "asset": 0]], "clips": ["idle": "idle.json"]
        ]
        try body(root, &manifest)
    }
    private func write(_ manifest: [String: Any], to root: URL) throws {
        try JSONSerialization.data(withJSONObject: manifest).write(to: root.appendingPathComponent("runtime.json"))
    }

    func testLoadsMetadataAndSampledGeometry() throws {
        try withBundle { root, manifest in
            try write(manifest, to: root)
            let data = try CharacterData(directory: root)
            XCTAssertEqual(data.manifest.profile, "test")
            let clip = try XCTUnwrap(data.animations["idle"])
            XCTAssertEqual(clip.duration, 1)
            XCTAssertTrue(clip.loops)
            XCTAssertEqual(clip.sample(phase: 0.5)[0].values[4], 5)
        }
    }

    func testRejectsUnsupportedFormatAndInvalidMeshTopology() throws {
        try withBundle { root, manifest in
            manifest["format"] = "future-v100"
            try write(manifest, to: root)
            XCTAssertThrowsError(try CharacterData(directory: root)) { XCTAssertTrue($0.localizedDescription.contains("Unsupported runtime")) }
            manifest["format"] = "modular-character-studio-ios-demo-v1"
            for triangles in [[0, 1], [0, 1, 3], [0, 1, -1]] {
                manifest["attachments"] = [["id": "body", "asset": 0, "source": [0, 0, 10, 0, 0, 10], "triangles": triangles]]
                try write(manifest, to: root)
                XCTAssertThrowsError(try CharacterData(directory: root)) { XCTAssertTrue($0.localizedDescription.contains("topology")) }
            }
        }
    }

    func testRejectsEscapingPathsAndInvalidFrameReferences() throws {
        try withBundle { root, manifest in
            manifest["clips"] = ["idle": "../outside.json"]
            try write(manifest, to: root)
            XCTAssertThrowsError(try CharacterData(directory: root)) { XCTAssertTrue($0.localizedDescription.contains("escapes")) }
            manifest["clips"] = ["idle": "idle.json"]
            manifest["attachments"] = []
            try write(manifest, to: root)
            XCTAssertThrowsError(try CharacterData(directory: root)) { XCTAssertTrue($0.localizedDescription.contains("attachment geometry")) }
        }
    }

    func testResourceLookupAcceptsSymlinkedBundleRoot() throws {
        try withBundle { root, _ in
            let resources = root.appendingPathComponent("Resources", isDirectory: true)
            let runtime = resources.appendingPathComponent("CharacterRuntime", isDirectory: true)
            try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
            let alias = root.appendingPathComponent("BundleAlias", isDirectory: true)
            try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: resources)
            let resolved = try CharacterData.resource("CharacterRuntime", in: alias)
            XCTAssertEqual(resolved, runtime.standardizedFileURL.resolvingSymlinksInPath())
        }
    }

    func testResourceLookupStillRejectsSymlinkEscapesAndSiblingPrefixes() throws {
        try withBundle { root, _ in
            let resources = root.appendingPathComponent("Resources", isDirectory: true)
            let sibling = root.appendingPathComponent("Resources-outside", isDirectory: true)
            try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: resources.appendingPathComponent("escape"), withDestinationURL: sibling)
            for path in ["escape", "../Resources-outside", "..", "", sibling.path] {
                XCTAssertThrowsError(try CharacterData.resource(path, in: resources), path)
            }
        }
    }

    func testRealExportWhenSupplied() throws {
        guard let path = ProcessInfo.processInfo.environment["MCS_RUNTIME_DIRECTORY"] else {
            throw XCTSkip("Set MCS_RUNTIME_DIRECTORY to an exported CharacterRuntime folder for the integration check.")
        }
        let data = try CharacterData(directory: URL(fileURLWithPath: path))
        XCTAssertEqual(data.animations.count, 11)
        XCTAssertEqual(data.manifest.loadout["activeArmSet"]?.id, "heavyPlateV1")
        let rig = try XCTUnwrap(data.manifest.aimRig)
        let bow = try XCTUnwrap(data.animations["bowDraw"])
        let bowAttachment = try XCTUnwrap(data.manifest.attachments.first { $0.id == "bow" })
        let asset = data.manifest.assets[bowAttachment.asset]
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(try CharacterData.resource(asset.path, in: data.root) as CFURL, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        let deformation = try XCTUnwrap(BowSpriteDeformation(image: image, renderRect: CGRect(x: 0, y: 0, width: asset.width, height: asset.height)))
        let pivot = CGPoint(x: asset.width*0.2153, y: asset.height*0.622)
        XCTAssertEqual(deformation.point(pivot, pivot: pivot, progress: 1), pivot, "the bow grip stays fixed")
        XCTAssertGreaterThan(deformation.point(deformation.top, pivot: pivot, progress: 1).x, deformation.top.x)
        XCTAssertGreaterThan(deformation.bottom.y-deformation.top.y, asset.height*0.4)
        let restBase = try XCTUnwrap(BowAimSolver.sampleWorld(bow, phase: 0))
        var previousNockX = -Double.infinity
        let restingGrip = BowAimSolver.solve(world: restBase, rig: rig, pitch: 0, drawProgress: 0)["handL"]!
        for progress in [0.0, 0.25, 0.5, 0.75, 1] {
            let world = BowAimSolver.solve(world: restBase, rig: rig, pitch: 0, drawProgress: progress)
            let nock = try XCTUnwrap(BowAimSolver.arrowNock(world: world, pitch: 0, drawProgress: progress))
            XCTAssertGreaterThan(nock.x, previousNockX)
            previousNockX = nock.x
            XCTAssertEqual(world["handL"]!.x, restingGrip.x, accuracy: 1e-8)
            XCTAssertEqual(world["handL"]!.y, restingGrip.y, accuracy: 1e-8)
        }
        for phase in [0.0, 0.37, 1.0] {
            let base = try XCTUnwrap(BowAimSolver.sampleWorld(bow, phase: phase))
            for pitch in [-90.0, -45, 0, 45, 90] {
                let world = BowAimSolver.solve(world: base, rig: rig, pitch: pitch, drawProgress: phase)
                let hand = try XCTUnwrap(world["handL"])
                for id in ["handL", "handR"] {
                    let parent = rig.parents[id]!
                    let neutral = RigMatrix(rig.bindWorld[parent]!).inverse.times(RigMatrix(rig.bindWorld[id]!)).angle
                    let local = world[parent]!.inverse.times(world[id]!).angle
                    let bend = abs(atan2(sin(local-neutral), cos(local-neutral))) * 180 / .pi
                    XCTAssertLessThanOrEqual(bend, (id == "handL" ? 5 : 30) + 1e-6)
                }
                let angle = hand.angle + Double.pi/2
                XCTAssertEqual(cos(angle), -cos(pitch * .pi / 180), accuracy: 1e-8)
                XCTAssertEqual(sin(angle), sin(pitch * .pi / 180), accuracy: 1e-8)
                // Aim must leave the lower-body animation untouched.
                XCTAssertEqual(world["footL"]!.x, base["footL"]!.x, accuracy: 1e-8)
                let frame = data.sample(animation: "bowDraw", phase: phase, bowAimPitchDegrees: pitch)
                XCTAssertNotNil(frame.bowNock)
                let nock = try XCTUnwrap(frame.bowNock)
                let fingers = world["handR"]!.point(BowAimSolver.drawingGrip)
                XCTAssertEqual(fingers.x, nock.x, accuracy: 0.01, "rear fingertips reach nock at \(pitch)°")
                XCTAssertEqual(fingers.y, nock.y, accuracy: 0.01, "rear fingertips reach nock at \(pitch)°")
                let grip = world["handL"]!.point(CGPoint(x: 0, y: 90))
                let dx = -cos(pitch * .pi / 180), dy = sin(pitch * .pi / 180)
                let across = (nock.x-grip.x) * -dy + (nock.y-grip.y) * dx
                XCTAssertEqual(across, BowAimSolver.arrowHandClearance, accuracy: 1e-8)
                XCTAssertTrue(frame.layers.flatMap(\.values).allSatisfy(\.isFinite))
                let ids = frame.layers.map { data.manifest.attachments[$0.attachment].id }
                XCTAssertFalse(ids.contains("weapon") || ids.contains("staff") || ids.contains("shield"))
            }
        }
        let horizontal = data.sample(animation: "bowDraw", phase: 0.7, bowAimPitchDegrees: 0)
        let upward = data.sample(animation: "bowDraw", phase: 0.7, bowAimPitchDegrees: -45)
        let arm = data.manifest.attachments.firstIndex { $0.id == "forearmVambraceL" }!
        XCTAssertNotEqual(horizontal.layers.first { $0.attachment == arm }!.values,
                          upward.layers.first { $0.attachment == arm }!.values)
        for animation in data.animations.values {
            for phase in [0.0, 0.123, 0.5, 0.999, 1.0] {
                let original = try XCTUnwrap(BowAimSolver.sampleWorld(animation, phase: phase))
                let clamped = BowAimSolver.constrainWrists(world: original, rig: rig, bow: false)
                for id in ["handL", "handR"] {
                    let parent = rig.parents[id]!
                    let neutral = RigMatrix(rig.bindWorld[parent]!).inverse.times(RigMatrix(rig.bindWorld[id]!)).angle
                    let local = clamped[parent]!.inverse.times(clamped[id]!).angle
                    XCTAssertLessThanOrEqual(abs(atan2(sin(local-neutral), cos(local-neutral))) * 180 / .pi, 30.000001)
                }
                let layers = animation.sample(phase: phase)
                XCTAssertFalse(layers.isEmpty)
                XCTAssertTrue(layers.flatMap(\.values).allSatisfy(\.isFinite))
            }
        }
    }

    func testBowReleaseTiming() {
        let hold = BowRelease(elapsed: 0.05, drawProgress: 1)
        XCTAssertEqual(hold.reachProgress, 0)
        XCTAssertEqual(hold.leadRetraction, 0)
        let catchTime = BowRelease.pauseDuration + BowRelease.reachDuration
        XCTAssertEqual(catchTime, 1, accuracy: 1e-8)
        XCTAssertEqual(BowRelease.settleDuration, 1, accuracy: 1e-8)
        XCTAssertEqual(BowRelease.duration, 2, accuracy: 1e-8)
        let settling = BowRelease(elapsed: 1.5, drawProgress: 1)
        XCTAssertTrue(settling.hasReconnected)
        XCTAssertFalse(settling.isComplete)
        XCTAssertEqual(settling.settleProgress, 0.5, accuracy: 1e-8)
        let reconnect = BowRelease(elapsed: catchTime, drawProgress: 1)
        XCTAssertEqual(reconnect.reachProgress, 1)
        XCTAssertTrue(reconnect.hasReconnected)
        XCTAssertGreaterThan(reconnect.leadRetraction, 0)
        let end = BowRelease(elapsed: BowRelease.duration, drawProgress: 1)
        XCTAssertTrue(end.isComplete)
        XCTAssertEqual(end.settleProgress, 1, accuracy: 1e-8)
        XCTAssertEqual(end.leadRetraction, 0, accuracy: 1e-8)
    }

    func testBowReleaseGeometryWhenExportSupplied() throws {
        guard let path = ProcessInfo.processInfo.environment["MCS_RUNTIME_DIRECTORY"] else { throw XCTSkip("Requires a real export.") }
        let data = try CharacterData(directory: URL(fileURLWithPath: path))
        let draw = try XCTUnwrap(data.animations["bowDraw"])
        let idle = try XCTUnwrap(data.animations["bowIdle"])
        let rig = try XCTUnwrap(data.manifest.aimRig)
        let bowID = try XCTUnwrap(data.manifest.attachments.firstIndex { $0.id == "bow" })
        let bow = data.manifest.attachments[bowID], asset = data.manifest.assets[bow.asset]
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(try CharacterData.resource(asset.path, in: data.root) as CFURL, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        let deformation = try XCTUnwrap(BowSpriteDeformation(image: image, renderRect: CGRect(x: 0, y: 0, width: asset.width, height: asset.height)))
        let span = BowStringSpan(top: deformation.top, bottom: deformation.bottom)
        let spans = [bow.asset: span]
        let catchTime = BowRelease.pauseDuration + BowRelease.reachDuration
        let idleWorld = try XCTUnwrap(BowAimSolver.sampleWorld(idle, phase: 0))
        for progress in [0.0, 0.4, 1.0] {
            let drawWorld = try XCTUnwrap(BowAimSolver.sampleWorld(draw, phase: progress))
            for pitch in stride(from: -90.0, through: 90.0, by: 15) {
                let before = data.sample(animation: "bowDraw", phase: progress, bowAimPitchDegrees: pitch)
                let beforeBow = RigMatrix(try XCTUnwrap(before.layers.first { $0.attachment == bowID }).values)
                let restFrame = data.sample(animation: "bowIdle", phase: 0, bowAimPitchDegrees: pitch)
                let restBow = RigMatrix(try XCTUnwrap(restFrame.layers.first { $0.attachment == bowID }).values)
                for time in [0.0, 0.05, 0.1, 0.55, catchTime,
                             catchTime + BowRelease.settleDuration * 0.25,
                             catchTime + BowRelease.settleDuration * 0.5,
                             catchTime + BowRelease.settleDuration * 0.75, BowRelease.duration] {
                    let release = BowRelease(elapsed: time, drawProgress: progress)
                    let frame = data.sample(animation: "bowIdle", phase: 0, bowAimPitchDegrees: pitch, bowRelease: release, bowStrings: spans)
                    XCTAssertEqual(frame.bowDrawProgress, 0, "limbs snap straight at release")
                    XCTAssertTrue(frame.layers.flatMap(\.values).allSatisfy(\.isFinite))
                    XCTAssertEqual(frame.bowNock != nil, release.hasReconnected)
                    let contact = try XCTUnwrap(frame.bowStringContact)
                    let matrix = RigMatrix(try XCTUnwrap(frame.layers.first { $0.attachment == bowID }).values)
                    // Fractional baked draw samples can have a tiny pre-existing scale
                    // difference; recovery must only interpolate it, never shrink from rotation.
                    XCTAssertEqual(matrix.sx, beforeBow.sx + (restBow.sx-beforeBow.sx)*release.settleProgress,
                                   accuracy: 0.001, "bow width has no rotation-induced shrinking")
                    XCTAssertEqual(matrix.sy, beforeBow.sy + (restBow.sy-beforeBow.sy)*release.settleProgress,
                                   accuracy: 0.001, "bow height has no rotation-induced shrinking")
                    let local = matrix.inverse.point(contact)
                    if !release.hasReconnected || time == catchTime {
                        let projected = span.closestPoint(to: local)
                        XCTAssertEqual(local.x, projected.x, accuracy: 0.01, "straight string until catch")
                        XCTAssertEqual(local.y, projected.y, accuracy: 0.01)
                    }
                    let baseWorld = drawWorld.reduce(into: [String: RigMatrix]()) { result, entry in
                        result[entry.key] = RigMatrix.blend(entry.value, idleWorld[entry.key]!, release.settleProgress)
                    }
                    let baseLayers = data.blendReleaseLayers(from: draw.sample(phase: progress), to: idle.sample(phase: 0),
                        fromWorld: drawWorld, toWorld: idleWorld, world: baseWorld, progress: release.settleProgress)
                    func boneWorld(_ id: String) throws -> RigMatrix {
                        let base = RigMatrix.blend(drawWorld[id]!, idleWorld[id]!, release.settleProgress)
                        let layer = try XCTUnwrap(frame.layers.first { data.manifest.attachments[$0.attachment].bone == id && data.manifest.attachments[$0.attachment].source == nil })
                        let original = try XCTUnwrap(baseLayers.first { $0.attachment == layer.attachment })
                        return RigMatrix(layer.values).times(RigMatrix(original.values).inverse).times(base)
                    }
                    let handR = try boneWorld("handR")
                    let fingers = handR.point(BowAimSolver.drawingGrip)
                    if release.hasReconnected {
                        XCTAssertEqual(fingers.x, contact.x, accuracy: 0.05, "rear fingers at string: pitch \(pitch), time \(time)")
                        XCTAssertEqual(fingers.y, contact.y, accuracy: 0.05)
                    }
                    if time <= BowRelease.pauseDuration {
                        for layer in frame.layers where data.manifest.attachments[layer.attachment].bone == "handR" {
                            let original = try XCTUnwrap(before.layers.first { $0.attachment == layer.attachment })
                            for (a, b) in zip(layer.values, original.values) { XCTAssertEqual(a, b, accuracy: 0.01, "released hand stays where it was") }
                        }
                    }
                    // Recover wrist transforms from their child hand even when forearms are meshes.
                    for id in ["handL", "handR"] {
                        let aimed = try boneWorld(id)
                        let parent = rig.parents[id]!
                        let neutral = RigMatrix(rig.bindWorld[parent]!).inverse.times(RigMatrix(rig.bindWorld[id]!)).angle
                        // The solver preserves the bounded wrist from the sampled base.
                        let bounded = BowAimSolver.constrainWrists(world: drawWorld, rig: rig, bow: true)
                        XCTAssertTrue(aimed.values.allSatisfy(\.isFinite))
                        XCTAssertLessThanOrEqual(abs(atan2(sin(bounded[parent]!.inverse.times(bounded[id]!).angle-neutral),
                                                          cos(bounded[parent]!.inverse.times(bounded[id]!).angle-neutral))) * 180 / .pi,
                                                 id == "handL" ? 5.000001 : 30.000001)
                    }
                    if release.isComplete {
                        let rest = data.sample(animation: "bowIdle", phase: 0, bowAimPitchDegrees: pitch)
                        for layer in frame.layers {
                            let original = try XCTUnwrap(rest.layers.first { $0.attachment == layer.attachment })
                            for (a, b) in zip(layer.values, original.values) { XCTAssertEqual(a, b, accuracy: 0.01, "settles exactly to idle") }
                        }
                    }
                }
            }
        }
    }

    func testTransitionKeepsMatchingGeometryContinuous() {
        let old = CharacterFrame(layers: [.init(attachment: 0, values: [0, 10])], bowNock: nil)
        let new = CharacterFrame(layers: [.init(attachment: 0, values: [10, 20]), .init(attachment: 1, values: [30, 40])], bowNock: nil)
        XCTAssertEqual(new.blended(from: old, progress: 0).layers[0].values, [0, 10])
        XCTAssertEqual(new.blended(from: old, progress: 0.5).layers[0].values, [5, 15])
        XCTAssertEqual(new.blended(from: old, progress: 1).layers[0].values, [10, 20])
        XCTAssertEqual(new.blended(from: old, progress: 0).layers[1].values, [30, 40])
    }

    func testRejectsInvalidAimHierarchy() throws {
        try withBundle { root, manifest in
            manifest["aimRig"] = ["parents": ["arm": "arm"], "bindWorld": ["arm": [1, 0, 0, 1, 0, 0]]]
            try write(manifest, to: root)
            XCTAssertThrowsError(try CharacterData(directory: root)) { XCTAssertTrue($0.localizedDescription.contains("hierarchy")) }
        }
    }
}
