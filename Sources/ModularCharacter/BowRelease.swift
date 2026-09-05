// Modular Character Studio · MIT
import Foundation

/// Procedural follow-through after a shot. Capture the draw fraction at release,
/// then advance elapsed in seconds. Aim/facing should stay fixed until complete.
public struct BowRelease {
    public static let pauseDuration = 0.1
    public static let reachDuration = 0.9
    public static let settleDuration = 1.0
    public static let duration = pauseDuration + reachDuration + settleDuration
    public var elapsed: Double
    public let drawProgress: Double

    public init(elapsed: Double = 0, drawProgress: Double) {
        self.elapsed = elapsed.isFinite ? max(0, elapsed) : 0
        self.drawProgress = drawProgress.isFinite ? min(1, max(0, drawProgress)) : 0
    }
    public var isComplete: Bool { elapsed >= Self.duration }
    var reachProgress: Double { Self.ease((elapsed - Self.pauseDuration) / Self.reachDuration) }
    var settleProgress: Double { Self.ease((elapsed - Self.pauseDuration - Self.reachDuration) / Self.settleDuration) }
    var hasReconnected: Bool { elapsed >= Self.pauseDuration + Self.reachDuration }
    var leadRetraction: Double { 70 * reachProgress * (1 - settleProgress) }
    private static func ease(_ value: Double) -> Double {
        let t = value.isFinite ? min(1, max(0, value)) : 0
        return t * t * (3 - 2 * t)
    }
}

/// Endpoints of the original masked string, in the bow texture's coordinates.
struct BowStringSpan {
    let top, bottom: CGPoint
    func closestPoint(to point: CGPoint) -> CGPoint {
        let dx = bottom.x - top.x, dy = bottom.y - top.y
        let t = min(0.95, max(0.05, ((point.x-top.x)*dx + (point.y-top.y)*dy) / max(1e-8, dx*dx+dy*dy)))
        return CGPoint(x: top.x+dx*t, y: top.y+dy*t)
    }
}
