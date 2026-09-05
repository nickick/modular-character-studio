// Modular Character Studio · MIT
#if canImport(UIKit)
import UIKit

/// Authored art faces left. Facing is a world transform and does not change the baked rig.
public enum CharacterFacing { case left, right }

/// Load once and reuse for multiple characters. Contains a fixed exported loadout.
public final class CharacterLibrary {
    let data: CharacterData
    let images: [UIImage]
    public var animations: [String: CharacterAnimation] { data.animations }
    public var canvasSize: CGSize { CGSize(width: data.manifest.canvas.width, height: data.manifest.canvas.height) }
    public var baseline: Double { data.manifest.baseline }
    public var profile: String { data.manifest.profile }
    public var equipmentIDs: [String: String] { data.manifest.loadout.mapValues(\.id) }

    public convenience init(bundle: Bundle = .main, resourceDirectory: String = "CharacterRuntime") throws {
        guard let resources = bundle.resourceURL else { throw CharacterData.invalid("Bundle has no resources.") }
        try self.init(directory: CharacterData.resource(resourceDirectory, in: resources))
    }

    public init(directory: URL) throws {
        let data = try CharacterData(directory: directory)
        self.data = data
        images = try data.manifest.assets.map { asset in
            let url = try CharacterData.resource(asset.path, in: data.root)
            guard let image = UIImage(contentsOfFile: url.path) else { throw CharacterData.invalid("Missing or unreadable texture: \(asset.path)") }
            return image
        }
    }

    /// Draw into a UIKit-style, Y-down context at the character's feet.
    /// Phase is clamped to 0...1. Callers own timing, looping, and animation transitions.
    /// An unknown animation draws nothing. Load and draw on the main thread.
    public func draw(in context: CGContext, animation: String, phase: Double,
                     at position: CGPoint, scale: Double = 1, facing: CharacterFacing = .left) {
        guard scale.isFinite, scale > 0, position.x.isFinite, position.y.isFinite else { return }
        context.saveGState()
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext(); context.restoreGState() }
        context.translateBy(x: position.x, y: position.y)
        context.scaleBy(x: facing == .right ? -scale : scale, y: scale)
        context.translateBy(x: -canvasSize.width / 2, y: -baseline)
        drawGeometry(context, animation: animation, phase: phase)
    }

    private func drawGeometry(_ context: CGContext, animation: String, phase: Double) {
        guard let clip = animations[animation] else { return }
        for current in clip.sample(phase: phase) {
            let attachment = data.manifest.attachments[current.attachment]
            let values = current.values
            let asset = data.manifest.assets[attachment.asset], image = images[attachment.asset]
            if let source = attachment.source, let triangles = attachment.triangles {
                for i in stride(from: 0, to: triangles.count, by: 3) {
                    let indices = Array(triangles[i..<(i + 3)])
                    let from = indices.map { CGPoint(x: source[$0 * 2], y: source[$0 * 2 + 1]) }
                    let to = indices.map { CGPoint(x: values[$0 * 2], y: values[$0 * 2 + 1]) }
                    guard let transform = triangleTransform(from, to) else { continue }
                    context.saveGState()
                    context.setShouldAntialias(false)
                    context.beginPath(); context.move(to: to[0]); context.addLine(to: to[1]); context.addLine(to: to[2]); context.closePath(); context.clip()
                    context.concatenate(transform)
                    image.draw(in: CGRect(x: 0, y: 0, width: asset.width, height: asset.height))
                    context.restoreGState()
                }
            } else {
                context.saveGState()
                context.concatenate(CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5]))
                if let cutout = attachment.clipPath, cutout.closed, cutout.nodes.count >= 3 {
                    let nodes = cutout.nodes
                    context.beginPath(); context.move(to: CGPoint(x: nodes[0].x * asset.width, y: nodes[0].y * asset.height))
                    for i in 1...nodes.count {
                        let from = nodes[i - 1], to = nodes[i % nodes.count]
                        context.addCurve(to: CGPoint(x: to.x * asset.width, y: to.y * asset.height), control1: CGPoint(x: (from.out?.x ?? from.x) * asset.width, y: (from.out?.y ?? from.y) * asset.height), control2: CGPoint(x: (to.in?.x ?? to.x) * asset.width, y: (to.in?.y ?? to.y) * asset.height))
                    }
                    context.closePath(); context.clip()
                }
                if let strips = attachment.strips {
                    for strip in strips {
                        context.saveGState()
                        context.clip(to: CGRect(x: strip.x, y: strip.y, width: strip.width + 0.5, height: strip.height))
                        context.translateBy(x: strip.x, y: strip.y)
                        context.scaleBy(x: (strip.width + 0.5) / strip.sourceWidth, y: strip.height / asset.height)
                        image.draw(in: CGRect(x: -strip.sourceX, y: 0, width: asset.width, height: asset.height))
                        context.restoreGState()
                    }
                } else { image.draw(in: CGRect(x: 0, y: 0, width: asset.width, height: asset.height)) }
                context.restoreGState()
            }
        }
    }
    private func triangleTransform(_ s: [CGPoint], _ d: [CGPoint]) -> CGAffineTransform? {
        let source = CGAffineTransform(a: s[1].x - s[0].x, b: s[1].y - s[0].y, c: s[2].x - s[0].x, d: s[2].y - s[0].y, tx: s[0].x, ty: s[0].y)
        guard abs(source.a * source.d - source.b * source.c) > 0.00000001 else { return nil }
        let destination = CGAffineTransform(a: d[1].x - d[0].x, b: d[1].y - d[0].y, c: d[2].x - d[0].x, d: d[2].y - d[0].y, tx: d[0].x, ty: d[0].y)
        return source.inverted().concatenating(destination)
    }
}
#endif
