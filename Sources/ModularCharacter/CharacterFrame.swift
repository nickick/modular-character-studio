// Modular Character Studio · MIT
import Foundation

/// Immutable sampled geometry; safe to hand to an asynchronous Canvas renderer.
public struct CharacterFrame {
    let layers: [RuntimeLayerFrame]
    var bowDrawProgress = 0.0
    /// Authored-space arrow socket, with clearance above the bow hand.
    /// Transform using the same feet/scale/facing as the character.
    public let bowNock: CGPoint?

    /// Blend matching attachments; new equipment/expressions switch immediately.
    public func blended(from previous: CharacterFrame, progress: Double) -> CharacterFrame {
        let t = min(1, max(0, progress.isFinite ? progress : 1))
        guard t < 1 else { return self }
        let old = Dictionary(previous.layers.map { ($0.attachment, $0) }, uniquingKeysWith: { first, _ in first })
        return CharacterFrame(layers: layers.map { layer in
            guard let from = old[layer.attachment], from.values.count == layer.values.count else { return layer }
            return RuntimeLayerFrame(attachment: layer.attachment,
                values: zip(from.values, layer.values).map { $0+($1-$0)*t })
        }, bowDrawProgress: bowDrawProgress, bowNock: bowNock)
    }
}

extension CharacterData {
    func sample(animation: String, phase: Double, bowAimPitchDegrees: Double? = nil) -> CharacterFrame {
        guard let clip = animations[animation] else { return CharacterFrame(layers: [], bowNock: nil) }
        let layers = clip.sample(phase: phase)
        guard let rig = manifest.aimRig,
              let base = BowAimSolver.sampleWorld(clip, phase: phase) else { return CharacterFrame(layers: layers, bowNock: nil) }
        let progress = animation == "bowDraw" ? min(1, max(0, phase.isFinite ? phase : 0)) : 0
        let pitch = animation.hasPrefix("bow") ? bowAimPitchDegrees.flatMap { $0.isFinite ? $0 : nil } : nil
        let aimed = pitch.map { BowAimSolver.solve(world: base, rig: rig, pitch: $0, drawProgress: progress) }
            ?? BowAimSolver.constrainWrists(world: base, rig: rig, bow: animation.hasPrefix("bow"))
        let updated = layers.map { layer -> RuntimeLayerFrame in
            let attachment = manifest.attachments[layer.attachment]
            if let mesh = attachment.aimMesh, let values = BowAimSolver.deform(mesh, rig: rig, world: aimed) {
                return RuntimeLayerFrame(attachment: layer.attachment, values: values)
            }
            guard attachment.source == nil, let bone = attachment.bone,
                  let from = base[bone], let to = aimed[bone] else { return layer }
            return RuntimeLayerFrame(attachment: layer.attachment, values: to.times(from.inverse).times(RigMatrix(layer.values)).values)
        }
        return CharacterFrame(layers: updated, bowDrawProgress: progress,
                              bowNock: pitch.flatMap { BowAimSolver.arrowNock(world: aimed, pitch: $0, drawProgress: progress) })
    }
}
