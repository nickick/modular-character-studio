// Modular Character Studio · MIT
#if canImport(UIKit)
import SwiftUI
import UIKit

/// A transparent character view fitted to its bounds. Supply normalized animation phase
/// from a TimelineView, game clock, or slider. Input/gameplay stay in the host application.
public struct ModularCharacterView: UIViewRepresentable {
    public let library: CharacterLibrary
    public var animation: String
    public var phase: Double
    public var facing: CharacterFacing

    public init(library: CharacterLibrary, animation: String = "idle", phase: Double = 0, facing: CharacterFacing = .left) {
        self.library = library; self.animation = animation; self.phase = phase; self.facing = facing
    }
    public func makeUIView(context: Context) -> CharacterCanvasView { CharacterCanvasView() }
    public func updateUIView(_ view: CharacterCanvasView, context: Context) {
        view.library = library; view.animation = animation; view.phase = phase; view.facing = facing
        view.setNeedsDisplay()
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
