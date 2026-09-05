// Modular Character Studio · MIT. Generated resources carry their own CC0 notice.
// A small SwiftUI/CoreGraphics slice inspired by Den Hunter's rig playback and
// shared attack pad, melee/ranged switch, hold-to-block, and dodge action bar.
import SwiftUI
import UIKit
import Combine
import ModularCharacter

@main
struct PlateDemoApp: App {
    var body: some Scene { WindowGroup { PlateDemoView() } }
}

// MARK: - Small deterministic training simulation (no game package dependency)

struct DemoArrow { var x: Double; let direction: Double }
struct DemoSimulation {
    enum Mode: String { case melee, bow }
    var mode: Mode = .melee
    var time = 0.0
    var playerX = 230.0
    var targetX = 525.0
    var facing = 1.0
    var movement = 0.0
    var guarding = false
    var attackHeldAt: Double?
    var cancelled = false
    var action: String?
    var actionBegan = 0.0
    var hitApplied = false
    var hits = 0
    var arrows: [DemoArrow] = []
    var message = "Move closer to strike, or switch to the bow."
    var hitFlashUntil = 0.0
    var dodgeReadyAt = 0.0

    var isDodging: Bool { action?.contains("Dodge") == true || action?.hasPrefix("dodge") == true }
    var charge: Double { attackHeldAt.map { min(1, max(0, (time - $0) / 1.2)) } ?? 0 }
    var canAct: Bool { action == nil }
    var clip: String {
        if let action { return action }
        if mode == .bow {
            if attackHeldAt != nil { return "bowDraw" }
            return abs(movement) > 0.05 ? "bowRunForward" : "bowIdle"
        }
        if guarding { return abs(movement) > 0.05 ? "shieldMoveForward" : "shieldUp" }
        return abs(movement) > 0.05 ? "run" : "idle"
    }

    mutating func setMode(_ next: Mode) {
        guard action == nil else { return }
        mode = next; releaseInputs()
        message = next == .bow ? "Hold the attack pad to draw. Release to fire." : "Tap the attack pad to swing. Hold the shield to guard."
    }
    mutating func releaseInputs() { attackHeldAt = nil; cancelled = false; guarding = false; movement = 0 }
    mutating func beginAttack() {
        guard canAct, attackHeldAt == nil else { return }
        guarding = false; cancelled = false; attackHeldAt = time
    }
    mutating func releaseAttack() {
        guard attackHeldAt != nil else { return }
        let power = charge
        attackHeldAt = nil
        defer { cancelled = false }
        guard !cancelled, canAct else { message = "Attack cancelled."; return }
        if mode == .bow {
            arrows.append(DemoArrow(x: playerX + facing * 105, direction: facing))
            message = power > 0.85 ? "Full draw!" : "Quick shot. Hold longer to finish drawing."
        } else {
            action = "swordSwing"; actionBegan = time; hitApplied = false
        }
    }
    mutating func dodge() {
        guard canAct, time >= dodgeReadyAt else { return }
        releaseInputs(); action = mode == .bow ? "bowDodgeForward" : "dodgeForward"
        actionBegan = time; dodgeReadyAt = time + 1.0
    }
    mutating func registerImpact() {
        hits += 1; hitFlashUntil = time + 0.18; message = "Target impact"
    }
    mutating func advance(_ seconds: Double, durations: [String: Double]) {
        let dt = min(0.05, max(0, seconds)); time += dt
        if isDodging { playerX += facing * 280 * dt }
        else if action == nil && attackHeldAt == nil {
            playerX += movement * (guarding ? 65 : 150) * dt
            if abs(movement) > 0.05 { facing = movement < 0 ? -1 : 1 }
        }
        playerX = min(665, max(55, playerX))
        if action == "swordSwing", !hitApplied, time - actionBegan >= (durations["swordSwing"] ?? 1.05) * 0.42 {
            hitApplied = true
            if abs(targetX - playerX) < 140 && (targetX - playerX) * facing > 0 { registerImpact() }
            else { message = "Out of reach. Move toward the target." }
        }
        if let action, time - actionBegan >= (durations[action] ?? 0.56) { self.action = nil }
        var remaining: [DemoArrow] = []
        for var arrow in arrows {
            let before = arrow.x; arrow.x += arrow.direction * 510 * dt
            if (before - targetX) * (arrow.x - targetX) <= 0 { registerImpact() }
            else if arrow.x > -30 && arrow.x < 750 { remaining.append(arrow) }
        }
        arrows = remaining

    }
}

// A touch establishes a fresh origin. Only horizontal travel affects movement.
struct DemoHorizontalJoystick {
    var origin: CGPoint?
    var cursor: CGPoint?
    var value = 0.0
    let radius = 37.0
    mutating func begin(at point: CGPoint) { origin = point; move(to: point) }
    mutating func move(to point: CGPoint) {
        guard let origin else { return }
        let dx = min(radius, max(-radius, Double(point.x - origin.x)))
        value = dx / radius
        cursor = CGPoint(x: origin.x + dx, y: origin.y)
    }
    mutating func end() { origin = nil; cursor = nil; value = 0 }
}

@MainActor
final class DemoModel: ObservableObject {
    @Published var state = DemoSimulation()
    @Published var error: String?
    @Published var inputGeneration = 0
    let library: CharacterLibrary?
    private var lastTime: TimeInterval?
    private var clipBegan = 0.0
    private var previousClip = "idle"
    private var previousActionBegan = -1.0
    var phase = 0.0
    var durations: [String: Double] { library?.animations.mapValues(\.duration) ?? [:] }

    init() {
        do { library = try CharacterLibrary() }
        catch { library = nil; self.error = error.localizedDescription }
    }
    func tick(_ now: TimeInterval) {
        defer { lastTime = now }
        guard library != nil, let lastTime else { return }
        var next = state; next.advance(now - lastTime, durations: durations)
        if next.clip != previousClip || (next.action != nil && next.actionBegan != previousActionBegan) {
            clipBegan = next.time; previousClip = next.clip; previousActionBegan = next.actionBegan
        }
        let duration = durations[next.clip] ?? 1
        let elapsed = next.time - (next.attackHeldAt ?? clipBegan)
        let raw = elapsed / duration
        phase = library?.animations[next.clip]?.loops == true ? raw.truncatingRemainder(dividingBy: 1) : min(1, raw)
        state = next
    }
    func pause() { state.releaseInputs(); lastTime = nil; inputGeneration += 1 }
    func reset() { inputGeneration += 1; state = DemoSimulation(); phase = 0; previousClip = "idle"; clipBegan = 0; previousActionBegan = -1; lastTime = nil }
}

// MARK: - Native drawing: sampled matrices and triangle deformation, not spritesheets

struct DemoStage: UIViewRepresentable {
    let library: CharacterLibrary
    let state: DemoSimulation
    let phase: Double
    func makeUIView(context: Context) -> DemoStageView { DemoStageView() }
    func updateUIView(_ view: DemoStageView, context: Context) {
        view.library = library; view.state = state; view.phase = phase; view.setNeedsDisplay()
    }
}

final class DemoStageView: UIView {
    var library: CharacterLibrary?
    var state = DemoSimulation()
    var phase = 0.0
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; backgroundColor = .clear; isUserInteractionEnabled = false }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let library else { return }
        let scale = bounds.width / 720
        let ground = bounds.height * 0.78
        context.setStrokeColor(UIColor.white.withAlphaComponent(0.055).cgColor)
        context.setLineWidth(1)
        for column in stride(from: 0.0, through: 720, by: 60) {
            context.move(to: CGPoint(x: column * scale, y: 0)); context.addLine(to: CGPoint(x: column * scale, y: bounds.height))
        }
        for row in stride(from: 0.0, through: Double(bounds.height), by: 36) {
            context.move(to: CGPoint(x: 0, y: row)); context.addLine(to: CGPoint(x: bounds.width, y: row))
        }
        context.strokePath()
        context.setFillColor(UIColor(red: 0.15, green: 0.18, blue: 0.19, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: ground, width: bounds.width, height: bounds.height - ground))
        context.setStrokeColor(UIColor(red: 0.57, green: 0.51, blue: 0.32, alpha: 1).cgColor)
        context.move(to: CGPoint(x: 0, y: ground)); context.addLine(to: CGPoint(x: bounds.width, y: ground)); context.strokePath()
        let target = CGPoint(x: state.targetX * scale, y: ground)
        drawTarget(context, at: target, scale: scale)
        context.saveGState()
        context.translateBy(x: state.playerX * scale, y: ground)
        context.setFillColor(UIColor.black.withAlphaComponent(0.3).cgColor)
        context.fillEllipse(in: CGRect(x: -60 * scale, y: -8 * scale, width: 120 * scale, height: 16 * scale))
        library.draw(in: context, animation: state.clip, phase: phase, at: .zero,
                     scale: 0.36 * scale, facing: state.facing > 0 ? .right : .left)
        context.restoreGState()
        context.setStrokeColor(UIColor(red: 0.98, green: 0.82, blue: 0.47, alpha: 1).cgColor)
        context.setLineWidth(2)
        for arrow in state.arrows {
            let x = arrow.x * scale, y = ground - 205 * scale
            context.move(to: CGPoint(x: x - arrow.direction * 26 * scale, y: y)); context.addLine(to: CGPoint(x: x, y: y))
            context.move(to: CGPoint(x: x - arrow.direction * 8 * scale, y: y - 5 * scale)); context.addLine(to: CGPoint(x: x, y: y)); context.addLine(to: CGPoint(x: x - arrow.direction * 8 * scale, y: y + 5 * scale)); context.strokePath()
        }
    }

    private func drawTarget(_ context: CGContext, at point: CGPoint, scale: Double) {
        context.saveGState(); defer { context.restoreGState() }
        context.translateBy(x: point.x, y: point.y); context.scaleBy(x: scale, y: scale)
        context.setFillColor(UIColor(red: 0.42, green: 0.29, blue: 0.18, alpha: 1).cgColor)
        context.fill(CGRect(x: -7, y: -250, width: 14, height: 250))
        context.fill(CGRect(x: -70, y: -205, width: 140, height: 14))
        context.setFillColor((state.time < state.hitFlashUntil ? UIColor.white : UIColor(red: 0.66, green: 0.50, blue: 0.29, alpha: 1)).cgColor)
        context.fillEllipse(in: CGRect(x: -38, y: -265, width: 76, height: 90))
        context.setStrokeColor(UIColor(red: 0.38, green: 0.18, blue: 0.14, alpha: 1).cgColor)
        context.setLineWidth(9); context.strokeEllipse(in: CGRect(x: -24, y: -249, width: 48, height: 59))
    }


}

struct DemoMovementSurface: UIViewRepresentable {
    let enabled: Bool
    let resetToken: Int
    let movementChanged: (Double) -> Void
    func makeUIView(context: Context) -> DemoMovementInputView { DemoMovementInputView() }
    func updateUIView(_ view: DemoMovementInputView, context: Context) {
        view.movementChanged = movementChanged
        if view.resetToken != resetToken || !enabled { view.stop(notify: false) }
        view.resetToken = resetToken
        view.isUserInteractionEnabled = enabled
    }
    static func dismantleUIView(_ view: DemoMovementInputView, coordinator: ()) { view.stop() }
}

// Same touch-origin lifecycle as Den Hunter's MovementInputView, with Y locked.
final class DemoMovementInputView: UIView {
    var movementChanged: ((Double) -> Void)?
    var resetToken = 0
    private var movementTouch: UITouch?
    private var joystick = DemoHorizontalJoystick()
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear; isOpaque = false; isMultipleTouchEnabled = false
        isAccessibilityElement = true; accessibilityLabel = "Move character"
        accessibilityHint = "Touch anywhere in the arena and drag left or right. Vertical movement is locked."
        accessibilityIdentifier = "demo.move"; accessibilityTraits = .adjustable
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard movementTouch == nil, let touch = touches.min(by: { $0.timestamp < $1.timestamp }) else { return }
        movementTouch = touch; joystick.begin(at: touch.location(in: self)); changed()
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = movementTouch, touches.contains(where: { $0 === touch }) else { return }
        joystick.move(to: touch.location(in: self)); changed()
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = movementTouch, touches.contains(where: { $0 === touch }) else { return }
        stop()
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { stop() }
    override func didMoveToWindow() { if window == nil { stop() } }
    func stop(notify: Bool = true) {
        let active = movementTouch != nil || joystick.origin != nil
        movementTouch = nil; joystick.end(); setNeedsDisplay()
        if active && notify { movementChanged?(0) }
    }
    private func changed() { movementChanged?(joystick.value); setNeedsDisplay() }
    override func accessibilityIncrement() { accessibleMove(1) }
    override func accessibilityDecrement() { accessibleMove(-1) }
    private func accessibleMove(_ direction: Double) {
        movementChanged?(direction)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard self?.movementTouch == nil else { return }
            self?.movementChanged?(0)
        }
    }
    override func draw(_ rect: CGRect) {
        guard let origin = joystick.origin, let cursor = joystick.cursor,
              let context = UIGraphicsGetCurrentContext() else { return }
        context.setFillColor(UIColor.black.withAlphaComponent(0.3).cgColor)
        context.fillEllipse(in: CGRect(x: origin.x - 59, y: origin.y - 59, width: 118, height: 118))
        context.setStrokeColor(UIColor.white.withAlphaComponent(0.28).cgColor); context.setLineWidth(1.5)
        context.strokeEllipse(in: CGRect(x: origin.x - 59, y: origin.y - 59, width: 118, height: 118))
        context.move(to: CGPoint(x: origin.x - 37, y: origin.y)); context.addLine(to: CGPoint(x: origin.x + 37, y: origin.y)); context.strokePath()
        context.setFillColor(UIColor(red: 0.91, green: 0.73, blue: 0.42, alpha: 0.75).cgColor)
        context.fillEllipse(in: CGRect(x: cursor.x - 22, y: cursor.y - 22, width: 44, height: 44))
    }
}

// MARK: - Action bar and training surface

struct PlateDemoView: View {
    @StateObject private var model = DemoModel()
    @Environment(\.scenePhase) private var scenePhase
    private let clock = Timer.publish(every: 1.0 / 30, on: .main, in: .common).autoconnect()
    private let gold = Color(red: 0.91, green: 0.73, blue: 0.42)

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("MODULAR CHARACTER STUDIO").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).foregroundStyle(gold)
                    Text("Vanguard rig").font(.system(size: 27, weight: .semibold, design: .serif))
                    Text("Plate armor · sword & shield · bow").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Reset") { model.reset() }.font(.caption.bold()).tint(gold).accessibilityIdentifier("demo.reset")
            }.padding(20)
            if let error = model.error {
                ContentUnavailableView("Export needed", systemImage: "shippingbox", description: Text(error))
            } else if let library = model.library {
                DemoStage(library: library, state: model.state, phase: model.phase)
                    .overlay {
                        DemoMovementSurface(enabled: scenePhase == .active, resetToken: model.inputGeneration) { value in
                            model.state.movement = value
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(model.state.mode == .melee ? "SWORD & SHIELD" : "BOW READIED").font(.caption.bold()).foregroundStyle(gold)
                        }.padding(20).allowsHitTesting(false)
                    }
                    .accessibilityLabel("Training arena")
                    .accessibilityValue("\(model.state.mode.rawValue), \(model.state.clip)")
                    .accessibilityIdentifier("demo.arena")
            }
            Text(model.state.message).font(.system(size: 12, weight: .medium)).foregroundStyle(gold)
                .frame(maxWidth: .infinity, minHeight: 38).padding(.horizontal, 12).accessibilityIdentifier("demo.status")
            actionBar.padding(.horizontal, 14).padding(.vertical, 14)
                .background(Color(red: 0.16, green: 0.14, blue: 0.12))
            Text("Touch + drag the arena to move · tap to strike · hold to draw")
                .font(.system(size: 10)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(10)
        }
        .background(Color(red: 0.075, green: 0.09, blue: 0.105))
        .foregroundStyle(Color(red: 0.92, green: 0.91, blue: 0.86))
        .preferredColorScheme(.dark)
        .onReceive(clock) { _ in if scenePhase == .active { model.tick(ProcessInfo.processInfo.systemUptime) } }
        .onChange(of: scenePhase) { _, _ in model.pause() }
        .onDisappear { model.pause() }
    }
    private var actionBar: some View {
        HStack(spacing: 14) {
            Spacer(minLength: 0)
            VStack(spacing: 5) {
                Image(systemName: model.state.cancelled ? "xmark" : model.state.mode == .bow ? "arrow.up.right" : "figure.fencing")
                    .font(.system(size: 27, weight: .semibold))
                Text(model.state.cancelled ? "CANCEL" : model.state.mode == .bow ? "DRAW / FIRE" : "ATTACK").font(.system(size: 9, weight: .heavy))
                ProgressView(value: model.state.charge).tint(gold).frame(width: 54).opacity(model.state.attackHeldAt == nil ? 0 : 1)
            }
            .frame(width: 86, height: 86).background(model.state.cancelled ? Color.red.opacity(0.4) : gold.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(gold.opacity(0.55)))
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                model.state.beginAttack()
                model.state.cancelled = value.translation.height < -80
                if abs(value.translation.width) > 24 { model.state.facing = value.translation.width < 0 ? -1 : 1 }
            }.onEnded { _ in model.state.releaseAttack() })
            .opacity(model.state.canAct ? 1 : 0.4)
            .accessibilityLabel(model.state.mode == .melee ? "Attack" : "Draw and fire")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { model.state.beginAttack(); model.state.releaseAttack() }
            .accessibilityIdentifier("demo.attack")
            VStack(spacing: 8) {
                HStack(spacing: 3) {
                    modeButton(.melee, symbol: "figure.fencing", label: "Sword")
                    modeButton(.bow, symbol: "arrow.up.right", label: "Bow")
                }
                HStack(spacing: 8) {
                    VStack(spacing: 2) {
                        Image(systemName: "shield.lefthalf.filled").font(.system(size: 17, weight: .semibold))
                        Text("Block").font(.system(size: 9, weight: .bold))
                    }
                        .frame(width: 47, height: 37).background(model.state.guarding ? gold.opacity(0.4) : .black.opacity(0.2), in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { _ in
                            if model.state.mode == .melee && model.state.canAct && model.state.attackHeldAt == nil { model.state.guarding = true }
                        }.onEnded { _ in model.state.guarding = false })
                        .opacity(model.state.mode == .melee ? 1 : 0.25)
                        .accessibilityLabel("Hold shield to block").accessibilityAddTraits(.isButton)
                        .accessibilityAction { if model.state.mode == .melee && model.state.canAct { model.state.guarding.toggle() } }
                        .accessibilityIdentifier("demo.block")
                    Button { model.state.dodge() } label: {
                        VStack(spacing: 2) {
                            Image(systemName: "figure.run").font(.system(size: 17, weight: .semibold))
                            Text("Dodge").font(.system(size: 9, weight: .bold))
                        }.frame(width: 47, height: 37)
                    }.background(.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 7))
                        .disabled(!model.state.canAct || model.state.time < model.state.dodgeReadyAt)
                        .accessibilityLabel("Dodge").accessibilityIdentifier("demo.dodge")
                }
            }
            Spacer(minLength: 0)
        }.buttonStyle(.plain)
    }
    private func modeButton(_ mode: DemoSimulation.Mode, symbol: String, label: String) -> some View {
        Button { model.state.setMode(mode) } label: {
            VStack(spacing: 2) { Image(systemName: symbol); Text(label).font(.system(size: 9, weight: .bold)) }
                .frame(width: 48, height: 38)
                .background(model.state.mode == mode ? gold.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 7))
        }.disabled(model.state.action != nil).accessibilityIdentifier("demo.mode.\(mode.rawValue)")
            .accessibilityLabel("Equip \(label)").accessibilityValue(model.state.mode == mode ? "Selected" : "")
    }
}
