// Modular Character Studio · MIT
#if canImport(UIKit)
import SwiftUI
import UIKit

/// A transparent character view fitted to its bounds. Supply normalized animation phase
/// from a TimelineView, game clock, or slider. Input/gameplay stay in the host application.
public struct ModularCharacterView: View {
    public let library: CharacterLibrary
    public var animation: String
    public var phase: Double
    public var facing: CharacterFacing
    public var bowAimPitchDegrees: Double?
    public var bowRelease: BowRelease?

    public init(library: CharacterLibrary, animation: String = "idle", phase: Double = 0, facing: CharacterFacing = .left, bowAimPitchDegrees: Double? = nil, bowRelease: BowRelease? = nil) {
        self.library = library; self.animation = animation; self.phase = phase; self.facing = facing
        self.bowAimPitchDegrees = bowAimPitchDegrees
        self.bowRelease = bowRelease
    }
    public var body: some View {
        let frame = library.sample(animation: animation, phase: phase, bowAimPitchDegrees: bowAimPitchDegrees, bowRelease: bowRelease)
        Canvas(rendersAsynchronously: true) { context, bounds in
            let size = library.canvasSize
            let scale = min(bounds.width/size.width, bounds.height/size.height)
            let top = (bounds.height-size.height*scale)/2
            library.draw(in: context, frame: frame,
                         at: CGPoint(x: bounds.width/2, y: top+library.baseline*scale), scale: scale, facing: facing)
        }.allowsHitTesting(false)
    }
}

public final class CharacterCanvasView: UIView {
    var library: CharacterLibrary?
    var animation = "idle"
    var phase = 0.0
    var facing = CharacterFacing.left
    public override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false; backgroundColor = .clear; isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    public override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let library else { return }
        let size = library.canvasSize
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let top = (bounds.height - size.height * scale) / 2
        library.draw(in: context, animation: animation, phase: phase,
            at: CGPoint(x: bounds.midX, y: top + library.baseline * scale), scale: scale, facing: facing)
    }
}
#endif
