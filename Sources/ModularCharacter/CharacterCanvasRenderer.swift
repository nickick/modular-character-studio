// Modular Character Studio · MIT
#if canImport(UIKit)
import SwiftUI
import UIKit

extension CharacterLibrary {
    public func sample(animation: String, phase: Double, bowAimPitchDegrees: Double? = nil) -> CharacterFrame {
        data.sample(animation: animation, phase: phase, bowAimPitchDegrees: bowAimPitchDegrees)
    }

    /// GPU-backed SwiftUI Canvas path, matching the main client's scoped draws.
    /// Unlike UIView.draw, this can render asynchronously without CPU-rasterizing every triangle.
    public func draw(in context: GraphicsContext, frame: CharacterFrame,
                     at position: CGPoint, scale: Double = 1, facing: CharacterFacing = .left,
                     bowOverlay: ((GraphicsContext) -> Void)? = nil) {
        guard scale.isFinite, scale > 0, position.x.isFinite, position.y.isFinite else { return }
        let sceneContext = context
        var context = context
        context.translateBy(x: position.x, y: position.y)
        context.scaleBy(x: facing == .right ? -scale : scale, y: scale)
        context.translateBy(x: -canvasSize.width / 2, y: -baseline)
        let bowActive = frame.bowNock != nil
        func bone(_ layer: RuntimeLayerFrame) -> String { data.manifest.attachments[layer.attachment].bone ?? "" }
        func leadArm(_ layer: RuntimeLayerFrame) -> Bool { bowActive && ["upperArmL", "lowerArmL"].contains(bone(layer)) }
        func leadHand(_ layer: RuntimeLayerFrame) -> Bool {
            bowActive && bone(layer) == "handL" && data.manifest.attachments[layer.attachment].id.hasPrefix("hand")
        }
        func rearArm(_ layer: RuntimeLayerFrame) -> Bool { bowActive && ["upperArmR", "lowerArmR", "handR"].contains(bone(layer)) }
        func leg(_ layer: RuntimeLayerFrame) -> Bool { bone(layer).contains("Leg") || bone(layer).hasPrefix("foot") }
        let bowLayers = frame.layers.filter { data.manifest.attachments[$0.attachment].id == "bow" }
        func paint(_ current: RuntimeLayerFrame, in context: GraphicsContext, stringOnly: Bool = false) {
            let attachment = data.manifest.attachments[current.attachment], values = current.values
            let asset = data.manifest.assets[attachment.asset]
            let image = context.resolve(Image(uiImage: images[attachment.asset]))
            let rect = CGRect(x: 0, y: 0, width: asset.width, height: asset.height)
            if let source = attachment.source, let triangles = attachment.triangles {
                for i in stride(from: 0, to: triangles.count, by: 3) {
                    let indices = Array(triangles[i..<(i+3)])
                    let from = indices.map { CGPoint(x: source[$0*2], y: source[$0*2+1]) }
                    let to = indices.map { CGPoint(x: values[$0*2], y: values[$0*2+1]) }
                    guard let transform = triangleTransform(from, to) else { continue }
                    var triangle = context
                    triangle.clip(to: Path { path in path.move(to: to[0]); path.addLine(to: to[1]); path.addLine(to: to[2]); path.closeSubpath() }, style: FillStyle(antialiased: false))
                    triangle.concatenate(transform)
                    triangle.draw(image, in: rect)
                }
                return
            }
            var layer = context
            layer.concatenate(CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5]))
            if attachment.id == "bow", let bow = bows[attachment.asset], let nock = frame.bowNock {
                let localNock = RigMatrix(values).inverse.point(nock)
                let pivot = CGPoint(x: attachment.bowPivot?.x ?? asset.width*0.2153, y: attachment.bowPivot?.y ?? asset.height*0.622)
                if stringOnly {
                    bow.drawString(context: layer, image: image, renderRect: rect, pivot: pivot, nock: localNock, progress: frame.bowDrawProgress)
                } else {
                    bow.drawBody(context: layer, image: image, renderRect: rect, pivot: pivot, nock: localNock, progress: frame.bowDrawProgress)
                }
                return
            }
            guard !stringOnly else { return }
            if let cutout = attachment.clipPath, cutout.closed, cutout.nodes.count >= 3 {
                layer.clip(to: Path { path in
                    let nodes = cutout.nodes
                    path.move(to: CGPoint(x: nodes[0].x*asset.width, y: nodes[0].y*asset.height))
                    for i in 1...nodes.count {
                        let from = nodes[i-1], to = nodes[i % nodes.count]
                        path.addCurve(to: CGPoint(x: to.x*asset.width, y: to.y*asset.height),
                            control1: CGPoint(x: (from.out?.x ?? from.x)*asset.width, y: (from.out?.y ?? from.y)*asset.height),
                            control2: CGPoint(x: (to.in?.x ?? to.x)*asset.width, y: (to.in?.y ?? to.y)*asset.height))
                    }
                    path.closeSubpath()
                })
            }
            if let strips = attachment.strips {
                for strip in strips {
                    var column = layer
                    column.clip(to: Path(CGRect(x: strip.x, y: strip.y, width: strip.width+0.5, height: strip.height)))
                    column.translateBy(x: strip.x, y: strip.y)
                    column.scaleBy(x: (strip.width+0.5)/strip.sourceWidth, y: strip.height/asset.height)
                    column.draw(image, in: CGRect(x: -strip.sourceX, y: 0, width: asset.width, height: asset.height))
                }
            } else { layer.draw(image, in: rect) }
        }
        frame.layers.filter(leadArm).forEach { paint($0, in: context) }
        for layer in frame.layers where !leadArm(layer) && !leadHand(layer) && !rearArm(layer) {
            paint(layer, in: context)
            if data.manifest.attachments[layer.attachment].id == "bow" { bowOverlay?(sceneContext) }
        }
        if bowActive {
            // One masked overlay, not one offscreen surface per sprite/triangle.
            // Keep the string over the helmet, but let opaque leg/boot pixels hide it and the lead hand.
            context.drawLayer { overlay in
                bowLayers.forEach { paint($0, in: overlay, stringOnly: true) }
                frame.layers.filter(leadHand).forEach { paint($0, in: overlay) }
                overlay.blendMode = .destinationOut
                frame.layers.filter(leg).forEach { paint($0, in: overlay) }
            }
            frame.layers.filter(rearArm).forEach { paint($0, in: context) }
        }
    }
}
#endif
