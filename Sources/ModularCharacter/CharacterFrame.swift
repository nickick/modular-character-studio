// Modular Character Studio · MIT
import Foundation

/// Immutable sampled geometry; safe to hand to an asynchronous Canvas renderer.
public struct CharacterFrame {
    let layers: [RuntimeLayerFrame]
    var bowDrawProgress = 0.0
    var bowStringContact: CGPoint? = nil
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
        }, bowDrawProgress: bowDrawProgress, bowStringContact: bowStringContact, bowNock: bowNock)
    }
}

extension CharacterData {
    func sample(animation: String, phase: Double, bowAimPitchDegrees: Double? = nil,
                bowRelease: BowRelease? = nil, bowStrings: [Int: BowStringSpan] = [:]) -> CharacterFrame {
        if let release = bowRelease, let pitch = bowAimPitchDegrees, pitch.isFinite,
           let frame = sampleRelease(release, pitch: pitch, bowStrings: bowStrings) { return frame }
        guard let clip = animations[animation] else { return CharacterFrame(layers: [], bowNock: nil) }
        let layers = clip.sample(phase: phase)
        guard let rig = manifest.aimRig,
              let base = BowAimSolver.sampleWorld(clip, phase: phase) else { return CharacterFrame(layers: layers, bowNock: nil) }
        let progress = animation == "bowDraw" ? min(1, max(0, phase.isFinite ? phase : 0)) : 0
        let pitch = animation.hasPrefix("bow") ? bowAimPitchDegrees.flatMap { $0.isFinite ? $0 : nil } : nil
        let aimed = pitch.map { BowAimSolver.solve(world: base, rig: rig, pitch: $0, drawProgress: progress) }
            ?? BowAimSolver.constrainWrists(world: base, rig: rig, bow: animation.hasPrefix("bow"))
        let nock = pitch.flatMap { BowAimSolver.arrowNock(world: aimed, pitch: $0, drawProgress: progress) }
        return posedFrame(layers: layers, base: base, aimed: aimed, rig: rig,
                          progress: progress, stringContact: nock, nock: nock)
    }

    private func posedFrame(layers: [RuntimeLayerFrame], base: [String: RigMatrix],
                            aimed: [String: RigMatrix], rig: RuntimeAimRig, progress: Double,
                            stringContact: CGPoint?, nock: CGPoint?) -> CharacterFrame {
        let updated = layers.map { layer -> RuntimeLayerFrame in
            let attachment = manifest.attachments[layer.attachment]
            if let mesh = attachment.aimMesh, let values = BowAimSolver.deform(mesh, rig: rig, world: aimed) {
                return RuntimeLayerFrame(attachment: layer.attachment, values: values)
            }
            guard attachment.source == nil, let bone = attachment.bone,
                  let from = base[bone], let to = aimed[bone] else { return layer }
            return RuntimeLayerFrame(attachment: layer.attachment, values: to.times(from.inverse).times(RigMatrix(layer.values)).values)
        }
        return CharacterFrame(layers: updated, bowDrawProgress: progress, bowStringContact: stringContact, bowNock: nock)
    }

    private func sampleRelease(_ release: BowRelease, pitch: Double, bowStrings: [Int: BowStringSpan]) -> CharacterFrame? {
        if release.isComplete { return sample(animation: "bowIdle", phase: 0, bowAimPitchDegrees: pitch) }
        guard let draw = animations["bowDraw"], let idle = animations["bowIdle"], let rig = manifest.aimRig,
              let start = BowAimSolver.sampleWorld(draw, phase: release.drawProgress),
              let end = BowAimSolver.sampleWorld(idle, phase: 0) else { return nil }
        let t = release.settleProgress
        let base = start.reduce(into: [String: RigMatrix]()) { result, entry in
            result[entry.key] = RigMatrix.blend(entry.value, end[entry.key] ?? entry.value, t)
        }
        let layers = blendReleaseLayers(from: draw.sample(phase: release.drawProgress), to: idle.sample(phase: 0),
                                        fromWorld: start, toWorld: end, world: base, progress: t)
        let released = BowAimSolver.solve(world: start, rig: rig, pitch: pitch, drawProgress: release.drawProgress)
        guard let releasedGrip = released["handR"]?.point(BowAimSolver.drawingGrip) else { return nil }
        let leadReach = BowAimSolver.reach - release.leadRetraction
        let front = BowAimSolver.solve(world: base, rig: rig, pitch: pitch, drawProgress: 0, leadReach: leadReach)
        guard let rest = BowAimSolver.arrowNock(world: front, pitch: pitch, drawProgress: 0),
              let bowLayer = layers.first(where: { manifest.attachments[$0.attachment].id == "bow" }) else { return nil }
        let attachment = manifest.attachments[bowLayer.attachment]
        guard let span = bowStrings[attachment.asset], let bone = attachment.bone,
              let original = base[bone], let posed = front[bone] else { return nil }
        let bowMatrix = posed.times(original.inverse).times(RigMatrix(bowLayer.values))
        // Reconnect to the source texture's straight string, not an estimated grip offset.
        let straight = bowMatrix.point(span.closestPoint(to: bowMatrix.inverse.point(rest)))
        func blend(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
            CGPoint(x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t)
        }
        let stringContact = blend(straight, rest, t)
        let rearTarget = release.hasReconnected ? stringContact : blend(releasedGrip, straight, release.reachProgress)
        let aimed = release.reachProgress == 0 ? released : BowAimSolver.solve(world: base, rig: rig, pitch: pitch, drawProgress: 0,
                                        leadReach: leadReach, rearTarget: rearTarget)
        // Once caught, the fingers drive the string. As the bow arm extends,
        // preserve a little rear-elbow bend instead of leaving the string beyond reach.
        let attachedContact = release.hasReconnected ? (aimed["handR"]?.point(BowAimSolver.drawingGrip) ?? stringContact) : straight
        return posedFrame(layers: layers, base: base, aimed: aimed, rig: rig, progress: 0,
                          stringContact: attachedContact, nock: release.hasReconnected ? attachedContact : nil)
    }

    func blendReleaseLayers(from: [RuntimeLayerFrame], to: [RuntimeLayerFrame],
                            fromWorld: [String: RigMatrix], toWorld: [String: RigMatrix],
                            world: [String: RigMatrix], progress: Double) -> [RuntimeLayerFrame] {
        let source = Dictionary(from.map { ($0.attachment, $0) }, uniquingKeysWith: { first, _ in first })
        let blended = CharacterFrame(layers: to, bowNock: nil)
            .blended(from: CharacterFrame(layers: from, bowNock: nil), progress: progress)
        return blended.layers.map { layer in
            let attachment = manifest.attachments[layer.attachment]
            guard attachment.source == nil, let bone = attachment.bone,
                  let a = source[layer.attachment], let b = to.first(where: { $0.attachment == layer.attachment }),
                  let start = fromWorld[bone], let end = toWorld[bone], let current = world[bone] else { return layer }
            // Interpolate the rigid attachment relative to its bone. Averaging
            // world-matrix coefficients shrinks rotated sprites and shifts their grip.
            let localStart = start.inverse.times(RigMatrix(a.values))
            let localEnd = end.inverse.times(RigMatrix(b.values))
            return RuntimeLayerFrame(attachment: layer.attachment,
                values: current.times(RigMatrix.blend(localStart, localEnd, progress)).values)
        }
    }
}
