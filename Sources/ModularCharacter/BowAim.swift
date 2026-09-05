// Modular Character Studio · MIT
import Foundation

struct RuntimeAimMesh: Decodable {
    let parent, child: String
    let weights, bindPoints: [Double]
}
struct RuntimeAimRig: Decodable {
    let parents: [String: String]
    let bindWorld: [String: [Double]]
}

/// Affine math shared by sampled bones and the live two-arm aim solver.
struct RigMatrix {
    var a = 1.0, b = 0.0, c = 0.0, d = 1.0, x = 0.0, y = 0.0
    init() {}
    init(_ v: [Double]) { a = v[0]; b = v[1]; c = v[2]; d = v[3]; x = v[4]; y = v[5] }
    var values: [Double] { [a, b, c, d, x, y] }
    var angle: Double { atan2(b, a) }
    var sx: Double { hypot(a, b) }
    var sy: Double { (a * d - b * c) / max(1e-12, sx) }
    func point(_ p: CGPoint) -> CGPoint { CGPoint(x: a * p.x + c * p.y + x, y: b * p.x + d * p.y + y) }
    func times(_ r: Self) -> Self {
        Self([a*r.a+c*r.b, b*r.a+d*r.b, a*r.c+c*r.d, b*r.c+d*r.d, a*r.x+c*r.y+x, b*r.x+d*r.y+y])
    }
    var inverse: Self {
        let det = a*d-b*c
        return Self([d/det, -b/det, -c/det, a/det, (c*y-d*x)/det, (b*x-a*y)/det])
    }
    func rotated(to angle: Double) -> Self {
        Self([cos(angle)*sx, sin(angle)*sx, -sin(angle)*sy, cos(angle)*sy, x, y])
    }
    static func blend(_ from: Self, _ to: Self, _ t: Double) -> Self {
        let delta = atan2(sin(to.angle-from.angle), cos(to.angle-from.angle))
        let angle = from.angle + delta*t
        let sx = from.sx+(to.sx-from.sx)*t, sy = from.sy+(to.sy-from.sy)*t
        return Self([cos(angle)*sx, sin(angle)*sx, -sin(angle)*sy, cos(angle)*sy,
                     from.x+(to.x-from.x)*t, from.y+(to.y-from.y)*t])
    }
}

/// Port of the main client's shoulder-rooted bow arm plus two-bone string-arm IK.
/// Pitch is -90 (up) through +90 (down) in authored, left-facing coordinates.
enum BowAimSolver {
    static let reach = 290.0, restingDrawDistance = 100.0, drawDistance = 400.0
    // Between index and ring fingers on handOpenR, expressed in hand-bone space.
    // Source point (65, 181.6), transformed by the shared authored hand bind.
    static let drawingGrip = CGPoint(x: -25.26, y: 92.12)
    static let arrowHandClearance = 45.0
    static let leadWristLimit = 5 * Double.pi / 180

    static func constrainWrists(world: [String: RigMatrix], rig: RuntimeAimRig, bow: Bool) -> [String: RigMatrix] {
        var rotations: [String: Double] = [:]
        for id in ["handL", "handR"] {
            guard let parent = rig.parents[id], let hand = world[id], let forearm = world[parent],
                  let bind = rig.bindWorld[id], let parentBind = rig.bindWorld[parent] else { continue }
            let neutral = RigMatrix(parentBind).inverse.times(RigMatrix(bind)).angle
            let angle = forearm.inverse.times(hand).angle
            let delta = atan2(sin(angle-neutral), cos(angle-neutral))
            let limit = bow && id == "handL" ? leadWristLimit : Double.pi/6
            rotations[id] = neutral + min(limit, max(-limit, delta))
        }
        return applying(rotations, world: world, rig: rig)
    }
    /// Seat the shaft in the space above the bow fist, not through its underside.
    /// The perpendicular offset rotates with aim and mirrors with the complete rig.
    static func arrowNock(world: [String: RigMatrix], pitch: Double, drawProgress: Double = 1) -> CGPoint? {
        guard let hand = world["handL"], pitch.isFinite else { return nil }
        let radians = min(90, max(-90, pitch)) * .pi / 180
        let dx = -cos(radians), dy = sin(radians)
        let grip = hand.point(CGPoint(x: 0, y: 90))
        let seat = CGPoint(x: grip.x-dy*arrowHandClearance, y: grip.y+dx*arrowHandClearance)
        guard let shoulder = world["shoulderR"], let upper = world["upperArmR"],
              let lower = world["lowerArmR"], let wrist = world["handR"] else { return nil }
        let contact = wrist.point(drawingGrip)
        let firstLength = hypot(lower.x-upper.x, lower.y-upper.y)
        let secondLength = hypot(contact.x-lower.x, contact.y-lower.y)
        let radius = firstLength+secondLength-18.0
        let qx = seat.x-shoulder.x, qy = seat.y-shoulder.y
        let along = qx*dx+qy*dy
        let perpendicularSquared = max(0, qx*qx+qy*qy-along*along)
        let halfChord = sqrt(max(0, radius*radius-perpendicularSquared))
        // Shorten the draw at the edge of reach instead of letting IK miss the arrow.
        let progress = min(1, max(0, drawProgress.isFinite ? drawProgress : 0))
        let inner = abs(firstLength-secondLength)+1e-4
        func reachable(_ pull: Double) -> Double {
            var total = min(along+halfChord, max(along-halfChord, pull))
            if (total-along)*(total-along)+perpendicularSquared < inner*inner {
                total = along+sqrt(max(0, inner*inner-perpendicularSquared))
            }
            return total
        }
        let rest = reachable(restingDrawDistance)
        let total = rest+(reachable(drawDistance)-rest)*progress
        return CGPoint(x: seat.x-dx*total, y: seat.y-dy*total)
    }
    static func solve(world: [String: RigMatrix], rig: RuntimeAimRig, pitch: Double, drawProgress: Double = 1) -> [String: RigMatrix] {
        let world = constrainWrists(world: world, rig: rig, bow: true)
        guard pitch.isFinite, let left = world["shoulderL"], let right = world["shoulderR"],
              let upperR = world["upperArmR"], let lowerR = world["lowerArmR"], let handR = world["handR"] else { return world }
        let radians = min(90, max(-90, pitch)) * .pi / 180
        let unit = CGPoint(x: -cos(radians), y: sin(radians))
        guard let upperL = world["upperArmL"], let lowerL = world["lowerArmL"], let handL = world["handL"] else { return world }
        let targetL = left.inverse.point(CGPoint(x: left.x+unit.x*(reach-90), y: left.y+unit.y*(reach-90)))
        let upperSegment = upperL.inverse.times(lowerL), forearmSegment = lowerL.inverse.times(handL)
        let front = twoBone(target: targetL, first: upperSegment, second: forearmSegment)
        var rotations = ["upperArmL": front.upper, "lowerArmL": front.lower]
        let frontWorld = applying(rotations, world: world, rig: rig)
        let desiredHand = atan2(unit.y, unit.x)-Double.pi/2
        let originalWrist = RigMatrix(rig.bindWorld["lowerArmL"]!).inverse.times(RigMatrix(rig.bindWorld["handL"]!)).angle
        let desiredWrist = desiredHand-(frontWorld["lowerArmL"]?.angle ?? 0)
        let change = atan2(sin(desiredWrist-originalWrist), cos(desiredWrist-originalWrist))
        let wrist = originalWrist + min(leadWristLimit, max(-leadWristLimit, change))
        if abs(change) > leadWristLimit {
            // Keep the bow aimed, but move the elbow/shoulder instead of over-bending the wrist.
            let forearmAngle = desiredHand-wrist-left.angle
            let elbowX = targetL.x-(cos(forearmAngle)*forearmSegment.x-sin(forearmAngle)*forearmSegment.y)
            let elbowY = targetL.y-(sin(forearmAngle)*forearmSegment.x+cos(forearmAngle)*forearmSegment.y)
            let upperAngle = atan2(elbowY, elbowX)-atan2(upperSegment.y, upperSegment.x)
            rotations["upperArmL"] = upperAngle
            rotations["lowerArmL"] = forearmAngle-upperAngle
        }
        rotations["handL"] = wrist
        let bowWorld = applying(rotations, world: world, rig: rig)
        guard let nock = arrowNock(world: bowWorld, pitch: pitch, drawProgress: drawProgress) else { return world }
        let target = right.inverse.point(nock)
        let lowerLocal = upperR.inverse.times(lowerR), handLocal = lowerR.inverse.times(handR)
        let contact = handLocal.point(drawingGrip)
        let second = RigMatrix([1, 0, 0, 1, contact.x, contact.y])
        let back = twoBone(target: target, first: lowerLocal, second: second)
        rotations["upperArmR"] = back.upper
        rotations["lowerArmR"] = back.lower
        // The bounded rear wrist is part of the lower IK segment; its finger gap is the endpoint.
        return applying(rotations, world: world, rig: rig)
    }

    private static func twoBone(target: CGPoint, first: RigMatrix, second: RigMatrix) -> (upper: Double, lower: Double) {
        let upperLength = max(0.001, hypot(first.x, first.y)), lowerLength = max(0.001, hypot(second.x, second.y))
        let raw = hypot(target.x, target.y)
        let distance = min(upperLength+lowerLength-1e-6, max(abs(upperLength-lowerLength)+1e-6, raw))
        func clamp(_ value: Double) -> Double { min(1, max(-1, value)) }
        let offset = acos(clamp((distance*distance+upperLength*upperLength-lowerLength*lowerLength)/(2*distance*upperLength)))
        let elbow = acos(clamp((distance*distance-upperLength*upperLength-lowerLength*lowerLength)/(2*upperLength*lowerLength)))
        let upperAxis = atan2(first.y, first.x), lowerAxis = atan2(second.y, second.x)
        return (atan2(target.y,target.x)-offset-upperAxis, elbow+upperAxis-lowerAxis)
    }

    private static func applying(_ rotations: [String: Double], world: [String: RigMatrix], rig: RuntimeAimRig) -> [String: RigMatrix] {
        var result: [String: RigMatrix] = [:]
        // Exported hierarchy is validated as acyclic before this is called.
        func resolve(_ id: String) -> RigMatrix {
            if let cached = result[id] { return cached }
            guard let original = world[id] else { return RigMatrix() }
            guard let parent = rig.parents[id], let parentWorld = world[parent] else { result[id] = original; return original }
            var local = parentWorld.inverse.times(original)
            if let angle = rotations[id] { local = local.rotated(to: angle) }
            let next = resolve(parent).times(local)
            result[id] = next
            return next
        }
        for id in world.keys { _ = resolve(id) }
        return result
    }

    static func sampleWorld(_ clip: CharacterAnimation, phase: Double) -> [String: RigMatrix]? {
        guard let frames = clip.boneFrames else { return nil }
        let sample = min(1, max(0, phase.isFinite ? phase : 0)) * Double(frames.count-1)
        let index = Int(sample), next = min(index+1, frames.count-1)
        let t = !clip.endKeyed && next == frames.count-1 ? 0 : sample-Double(index)
        return frames[index].mapValues { RigMatrix($0) }.map { id, matrix in
            (id, RigMatrix.blend(matrix, RigMatrix(frames[next][id] ?? matrix.values), t))
        }.reduce(into: [:]) { $0[$1.0] = $1.1 }
    }

    static func deform(_ mesh: RuntimeAimMesh, rig: RuntimeAimRig, world: [String: RigMatrix]) -> [Double]? {
        guard let p = world[mesh.parent], let c = world[mesh.child],
              let bp = rig.bindWorld[mesh.parent], let bc = rig.bindWorld[mesh.child] else { return nil }
        let parentBind = RigMatrix(bp), childBind = RigMatrix(bc)
        let from = parentBind.inverse.times(childBind), to = p.inverse.times(c)
        return mesh.weights.enumerated().flatMap { index, weight -> [Double] in
            let skin = p.times(RigMatrix.blend(from, to, weight)).times(childBind.inverse)
            let point = skin.point(CGPoint(x: mesh.bindPoints[index*2], y: mesh.bindPoints[index*2+1]))
            return [point.x, point.y]
        }
    }
}
