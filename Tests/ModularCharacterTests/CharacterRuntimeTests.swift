import Foundation
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

    func testRealExportWhenSupplied() throws {
        guard let path = ProcessInfo.processInfo.environment["MCS_RUNTIME_DIRECTORY"] else {
            throw XCTSkip("Set MCS_RUNTIME_DIRECTORY to an exported CharacterRuntime folder for the integration check.")
        }
        let data = try CharacterData(directory: URL(fileURLWithPath: path))
        XCTAssertEqual(data.animations.count, 11)
        XCTAssertEqual(data.manifest.loadout["activeArmSet"]?.id, "heavyPlateV1")
        for animation in data.animations.values {
            for phase in [0.0, 0.123, 0.5, 0.999, 1.0] {
                let layers = animation.sample(phase: phase)
                XCTAssertFalse(layers.isEmpty)
                XCTAssertTrue(layers.flatMap(\.values).allSatisfy(\.isFinite))
            }
        }
    }
}
