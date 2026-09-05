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
