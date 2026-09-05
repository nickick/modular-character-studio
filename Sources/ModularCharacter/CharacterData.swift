// Modular Character Studio · MIT
import Foundation

struct RuntimeAsset: Decodable { let path: String; let width, height: Double }
struct RuntimeEquipment: Decodable { let id, label: String }
struct RuntimeCanvas: Decodable { let width, height: Double }
struct RuntimePoint: Decodable { let x, y: Double }
struct RuntimeNode: Decodable {
    let x, y: Double
    let `in`, out: RuntimePoint?
}
struct RuntimeCutout: Decodable { let closed: Bool; let nodes: [RuntimeNode] }
struct RuntimeStrip: Decodable { let sourceX, sourceWidth, x, width, y, height: Double }
struct RuntimeAttachment: Decodable {
    let id: String
    let asset: Int
    let source: [Double]?
    let triangles: [Int]?
    let clipPath: RuntimeCutout?
    let strips: [RuntimeStrip]?
}
struct RuntimeLayerFrame: Decodable { let attachment: Int; let values: [Double] }
public struct CharacterAnimation: Decodable {
    public let duration: Double
    public let loops: Bool
    let endKeyed: Bool
    let frames: [[RuntimeLayerFrame]]

    // Attachment/image changes step at the sample boundary; only matching layers interpolate.
    func sample(phase: Double) -> [RuntimeLayerFrame] {
        let phase = phase.isFinite ? max(0, min(1, phase)) : 0
        let sample = phase * Double(frames.count - 1)
        let index = Int(sample), next = min(index + 1, frames.count - 1)
        let fraction = !endKeyed && next == frames.count - 1 ? 0 : sample - Double(index)
        return frames[index].enumerated().map { position, current in
            guard frames[next].indices.contains(position) else { return current }
            let following = frames[next][position]
            guard following.attachment == current.attachment, following.values.count == current.values.count else { return current }
            return RuntimeLayerFrame(attachment: current.attachment,
                values: zip(current.values, following.values).map { $0 + ($1 - $0) * fraction })
        }
    }
}
struct RuntimeManifest: Decodable {
    let format, profile: String
    let canvas: RuntimeCanvas
    let baseline: Double
    let loadout: [String: RuntimeEquipment]
    let assets: [RuntimeAsset]
    let attachments: [RuntimeAttachment]
    let clips: [String: String]
}

struct CharacterData {
    let root: URL
    let manifest: RuntimeManifest
    let animations: [String: CharacterAnimation]

    init(directory: URL) throws {
        root = directory.standardizedFileURL.resolvingSymlinksInPath()
        let decoder = JSONDecoder()
        manifest = try decoder.decode(RuntimeManifest.self, from: Data(contentsOf: root.appendingPathComponent("runtime.json")))
        guard manifest.format == "modular-character-studio-ios-demo-v1" else {
            throw CharacterData.invalid("Unsupported runtime format: \(manifest.format). Re-export with a compatible version of Modular Character Studio.")
        }
        guard manifest.canvas.width.isFinite, manifest.canvas.width > 0,
              manifest.canvas.height.isFinite, manifest.canvas.height > 0, manifest.baseline.isFinite else {
            throw CharacterData.invalid("Invalid canvas dimensions or baseline.")
        }
        for asset in manifest.assets {
            _ = try Self.resource(asset.path, in: root)
            guard asset.width.isFinite, asset.width > 0, asset.height.isFinite, asset.height > 0 else {
                throw Self.invalid("Invalid texture dimensions: \(asset.path)")
            }
        }
        for attachment in manifest.attachments {
            guard manifest.assets.indices.contains(attachment.asset) else { throw Self.invalid("Invalid texture index: \(attachment.id)") }
            if let source = attachment.source {
                guard source.count >= 6, source.count.isMultiple(of: 2), source.allSatisfy(\.isFinite),
                      let triangles = attachment.triangles, !triangles.isEmpty, triangles.count.isMultiple(of: 3),
                      triangles.allSatisfy({ $0 >= 0 && $0 < source.count / 2 }) else {
                    throw Self.invalid("Invalid mesh topology: \(attachment.id)")
                }
            } else if attachment.triangles != nil { throw Self.invalid("Mesh has no source vertices: \(attachment.id)") }
            for strip in attachment.strips ?? [] {
                guard [strip.sourceX, strip.sourceWidth, strip.x, strip.width, strip.y, strip.height].allSatisfy(\.isFinite),
                      strip.sourceWidth > 0, strip.width > 0, strip.height > 0 else { throw Self.invalid("Invalid image strip: \(attachment.id)") }
            }
            for node in attachment.clipPath?.nodes ?? [] {
                let coordinates = [node.x, node.y, node.in?.x ?? node.x, node.in?.y ?? node.y, node.out?.x ?? node.x, node.out?.y ?? node.y]
                guard coordinates.allSatisfy(\.isFinite) else { throw Self.invalid("Invalid cutout: \(attachment.id)") }
            }
        }
        let manifest = self.manifest, root = self.root
        animations = try manifest.clips.mapValues { path in
            let clip = try decoder.decode(CharacterAnimation.self, from: Data(contentsOf: Self.resource(path, in: root)))
            guard clip.duration.isFinite, clip.duration > 0, clip.frames.count >= 2 else { throw Self.invalid("Invalid animation: \(path)") }
            for frame in clip.frames {
                for layer in frame {
                    guard manifest.attachments.indices.contains(layer.attachment), layer.values.allSatisfy(\.isFinite) else {
                        throw Self.invalid("Invalid attachment geometry in \(path)")
                    }
                    let attachment = manifest.attachments[layer.attachment]
                    guard layer.values.count == (attachment.source?.count ?? 6) else { throw Self.invalid("Invalid geometry size in \(path)") }
                }
            }
            return clip
        }
    }

    static func resource(_ path: String, in root: URL) throws -> URL {
        let url = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard !path.isEmpty, !path.hasPrefix("/"), url.path.hasPrefix(root.path + "/") else {
            throw invalid("Resource path escapes the exported directory: \(path)")
        }
        return url
    }

    static func invalid(_ message: String) -> NSError {
        NSError(domain: "ModularCharacter", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
