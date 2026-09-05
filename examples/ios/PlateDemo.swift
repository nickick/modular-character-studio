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

struct DemoArrow { var x, y: Double; let dx, dy: Double }
struct DemoSimulation {
    enum Mode: String { case melee, bow }
    var mode: Mode = .melee
    var time = 0.0
    var playerX = 230.0
    var targetX = 525.0
    var facing = 1.0
    var aimAngle = 0.0
    var aimPitch: Double { asin(sin(aimAngle)) * 180 / .pi }
    mutating func aim(at point: CGPoint) {
        guard hypot(point.x, point.y) > 8 else { return }
        aimAngle = atan2(point.y, point.x)
        if abs(cos(aimAngle)) > 0.02 { facing = cos(aimAngle) < 0 ? -1 : 1 }
    }
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
    var drawDuration = 1.55
    var charge: Double { attackHeldAt.map { min(1, max(0, (time - $0) / drawDuration)) } ?? 0 }
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
        aimAngle = facing > 0 ? 0 : .pi
        message = next == .bow ? "Hold the attack pad to draw. Release to fire." : "Tap the attack pad to swing. Hold the shield to guard."
    }
    mutating func releaseInputs() { attackHeldAt = nil; cancelled = false; guarding = false; movement = 0 }
    mutating func beginAttack() {
        guard canAct, attackHeldAt == nil else { return }
        guarding = false; cancelled = false; attackHeldAt = time
    }
    mutating func releaseAttack(origin: CGPoint? = nil) {
        guard attackHeldAt != nil else { return }
        let power = charge
        attackHeldAt = nil
        defer { cancelled = false }
        guard !cancelled, canAct else { message = "Attack cancelled."; return }
        if mode == .bow {
            let origin = origin ?? CGPoint(x: playerX + facing * 105, y: -205)
            arrows.append(DemoArrow(x: origin.x, y: origin.y, dx: cos(aimAngle), dy: sin(aimAngle)))
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
        let dt = min(0.1, max(0, seconds)); time += dt
        if isDodging { playerX += facing * 280 * dt }
        else if action == nil && attackHeldAt == nil {
            playerX += movement * (guarding ? 65 : 150) * dt
            if abs(movement) > 0.05 { facing = movement < 0 ? -1 : 1 }
            if mode == .bow && abs(movement) > 0.05 { aimAngle = facing > 0 ? 0 : .pi }
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
            let before = CGPoint(x: arrow.x, y: arrow.y)
            arrow.x += arrow.dx * 510 * dt; arrow.y += arrow.dy * 510 * dt
            // Swept segment vs the target ellipse: steep shots can miss, fast shots cannot tunnel.
            let a = CGPoint(x: (before.x-targetX)/38, y: (before.y+220)/45)
            let dx = (arrow.x-before.x)/38, dy = (arrow.y-before.y)/45
            let t = min(1, max(0, -(a.x*dx+a.y*dy)/max(1e-12, dx*dx+dy*dy)))
            if hypot(a.x+dx*t, a.y+dy*t) <= 1 { registerImpact() }
            else if arrow.x > -100 && arrow.x < 820 && arrow.y > -900 && arrow.y < 100 { remaining.append(arrow) }
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
final class DemoModel: NSObject, ObservableObject {
    @Published var state = DemoSimulation()
    @Published var error: String?
    @Published var inputGeneration = 0
    @Published var frame: CharacterFrame?
    let library: CharacterLibrary?
    private var lastTime: TimeInterval?
    private var clipBegan = 0.0
    private var previousClip = "idle"
    private var previousActionBegan = -1.0
    var phase = 0.0
    private var displayLink: CADisplayLink?
    private var transitionFrom: CharacterFrame?
    private var transitionBegan = 0.0
    private var durations: [String: Double] = [:]

    override init() {
        do { library = try CharacterLibrary() }
        catch { library = nil; self.error = error.localizedDescription }
        super.init()
        durations = library?.animations.mapValues(\.duration) ?? [:]
        state.drawDuration = durations["bowDraw"] ?? 1.55
        frame = library?.sample(animation: "idle", phase: 0)
    }
    func start() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(displayFrame(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 60)
        link.add(to: .main, forMode: .common); displayLink = link
    }
    @objc private func displayFrame(_ link: CADisplayLink) { tick(link.timestamp) }
    func tick(_ now: TimeInterval) {
        defer { lastTime = now }
        guard library != nil, let lastTime else { return }
        var next = state; next.advance(now - lastTime, durations: durations)
        if next.clip != previousClip || (next.action != nil && next.actionBegan != previousActionBegan) {
            transitionFrom = frame; transitionBegan = next.time
            clipBegan = next.time; previousClip = next.clip; previousActionBegan = next.actionBegan
        }
        let duration = durations[next.clip] ?? 1
        let elapsed = next.time - (next.clip == "bowDraw" ? (next.attackHeldAt ?? clipBegan) : clipBegan)
        let raw = elapsed / duration
        phase = library?.animations[next.clip]?.loops == true ? raw.truncatingRemainder(dividingBy: 1) : min(1, raw)
        let sampled = library?.sample(animation: next.clip, phase: phase, bowAimPitchDegrees: next.mode == .bow ? next.aimPitch : nil)
        // Bow uses the solved nock immediately so guide and fingertips stay together.
        if next.mode == .melee, let old = transitionFrom, let sampled {
            frame = sampled.blended(from: old, progress: (next.time-transitionBegan)/0.12)
        } else { frame = sampled }
        if next.time-transitionBegan >= 0.12 { transitionFrom = nil }
        state = next
    }
    func releaseAttack() {
        let nock = library?.sample(animation: state.clip, phase: phase, bowAimPitchDegrees: state.aimPitch).bowNock
        let origin = nock.map { CGPoint(x: state.playerX + ($0.x-(library?.canvasSize.width ?? 0)/2) * 0.36 * (state.facing > 0 ? -1 : 1),
                                      y: ($0.y-(library?.baseline ?? 0))*0.36) }
        state.releaseAttack(origin: origin)
    }
    func pause() { displayLink?.invalidate(); displayLink = nil; state.releaseInputs(); lastTime = nil; inputGeneration += 1 }
    func reset() { inputGeneration += 1; state = DemoSimulation(); state.drawDuration = durations["bowDraw"] ?? 1.55; phase = 0; previousClip = "idle"; clipBegan = 0; previousActionBegan = -1; lastTime = nil; transitionFrom = nil; frame = library?.sample(animation: "idle", phase: 0) }
}

// MARK: - Native drawing: sampled matrices and triangle deformation, not spritesheets

struct DemoStage: View {
    let library: CharacterLibrary
    let state: DemoSimulation
    let frame: CharacterFrame?
    var body: some View {
        Canvas(rendersAsynchronously: true) { context, size in
            let scale = size.width / 720, ground = size.height * 0.78
            let grid = Path { path in
                for x in stride(from: 0.0, through: size.width, by: 60*scale) {
                    path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: size.height))
                }
                for y in stride(from: 0.0, through: size.height, by: 36) {
                    path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: size.width, y: y))
                }
            }
            context.stroke(grid, with: .color(.white.opacity(0.055)))
            context.fill(Path(CGRect(x: 0, y: ground, width: size.width, height: size.height-ground)), with: .color(Color(red: 0.15, green: 0.18, blue: 0.19)))
            var world = context
            world.translateBy(x: 0, y: ground); world.scaleBy(x: scale, y: scale)
            world.stroke(Path { $0.move(to: .zero); $0.addLine(to: CGPoint(x: 720, y: 0)) }, with: .color(.yellow.opacity(0.4)))
            let wood = Color(red: 0.42, green: 0.29, blue: 0.18)
            world.fill(Path(CGRect(x: state.targetX-7, y: -250, width: 14, height: 250)), with: .color(wood))
            world.fill(Path(CGRect(x: state.targetX-70, y: -205, width: 140, height: 14)), with: .color(wood))
            world.fill(Path(ellipseIn: CGRect(x: state.targetX-38, y: -265, width: 76, height: 90)), with: .color(state.time < state.hitFlashUntil ? .white : Color(red: 0.66, green: 0.50, blue: 0.29)))
            world.stroke(Path(ellipseIn: CGRect(x: state.targetX-24, y: -249, width: 48, height: 59)), with: .color(Color(red: 0.38, green: 0.18, blue: 0.14)), lineWidth: 9)
            world.fill(Path(ellipseIn: CGRect(x: state.playerX-60, y: -8, width: 120, height: 16)), with: .color(.black.opacity(0.3)))
            if let frame {
                library.draw(in: world, frame: frame, at: CGPoint(x: state.playerX, y: 0), scale: 0.36, facing: state.facing > 0 ? .right : .left) { world in
                if state.mode == .bow, let nock = frame.bowNock {
                    let origin = CGPoint(x: state.playerX+(nock.x-library.canvasSize.width/2)*0.36*(state.facing > 0 ? -1 : 1), y: (nock.y-library.baseline)*0.36)
                    let dx = cos(state.aimAngle), dy = sin(state.aimAngle)
                    world.stroke(Path { path in path.move(to: origin); path.addLine(to: CGPoint(x: origin.x+dx*900, y: origin.y+dy*900)) }, with: .color(.yellow.opacity(0.3)), style: StrokeStyle(lineWidth: 1.5, dash: [8, 8]))
                    drawArrow(world, tip: CGPoint(x: origin.x+dx*150, y: origin.y+dy*150), dx: dx, dy: dy, length: 150)
                }
                }
            }
            for arrow in state.arrows { drawArrow(world, tip: CGPoint(x: arrow.x, y: arrow.y), dx: arrow.dx, dy: arrow.dy, length: 26) }
        }
    }
    private func drawArrow(_ context: GraphicsContext, tip: CGPoint, dx: Double, dy: Double, length: Double) {
        context.stroke(Path { path in
            path.move(to: CGPoint(x: tip.x-dx*length, y: tip.y-dy*length)); path.addLine(to: tip)
            path.move(to: CGPoint(x: tip.x-dx*8-dy*5, y: tip.y-dy*8+dx*5)); path.addLine(to: tip)
            path.addLine(to: CGPoint(x: tip.x-dx*8+dy*5, y: tip.y-dy*8-dx*5))
        }, with: .color(Color(red: 0.98, green: 0.82, blue: 0.47)), lineWidth: 2)
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
    private let gold = Color(red: 0.91, green: 0.73, blue: 0.42)

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                Text("MODULAR CHARACTER STUDIO").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).foregroundStyle(gold)
                Spacer()
                Button("Reset") { model.reset() }.font(.caption.bold()).tint(gold).accessibilityIdentifier("demo.reset")
            }.padding(20)
            if let error = model.error {
                ContentUnavailableView("Export needed", systemImage: "shippingbox", description: Text(error))
            } else if let library = model.library {
                DemoStage(library: library, state: model.state, frame: model.frame)
                    .overlay {
                        DemoMovementSurface(enabled: scenePhase == .active, resetToken: model.inputGeneration) { value in
                            model.state.movement = value
                        }
                    }
                    .accessibilityLabel("Training arena")
                    .accessibilityValue("\(model.state.mode.rawValue), \(model.state.clip)")
                    .accessibilityIdentifier("demo.arena")
            }
            Text(model.state.message).font(.system(size: 12, weight: .medium)).foregroundStyle(gold)
                .frame(maxWidth: .infinity, minHeight: 38).padding(.horizontal, 12).accessibilityIdentifier("demo.status")
            actionBar.padding(.horizontal, 14).padding(.vertical, 14)
                .background(Color(red: 0.16, green: 0.14, blue: 0.12))
            Text(model.state.mode == .bow ? "Hold DRAW · turn the aim dial · release to fire" : "Touch + drag the arena to move · tap to strike · hold to draw")
                .font(.system(size: 10)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(10)
        }
        .background(Color(red: 0.075, green: 0.09, blue: 0.105))
        .foregroundStyle(Color(red: 0.92, green: 0.91, blue: 0.86))
        .preferredColorScheme(.dark)
        .onAppear { if scenePhase == .active { model.start() } }
        .onChange(of: scenePhase) { _, phase in model.pause(); if phase == .active { model.start() } }
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
                if model.state.mode == .melee && abs(value.translation.width) > 24 { model.state.facing = value.translation.width < 0 ? -1 : 1 }
            }.onEnded { _ in model.releaseAttack() })
            .opacity(model.state.canAct ? 1 : 0.4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(model.state.mode == .melee ? "Attack" : "Draw and fire")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { model.state.beginAttack(); model.releaseAttack() }
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
            if model.state.mode == .bow { aimDial }
            Spacer(minLength: 0)
        }.buttonStyle(.plain)
    }
    private var aimDial: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().fill(.black.opacity(0.2))
                Circle().stroke(gold.opacity(0.5), lineWidth: 1)
                Path { path in
                    path.move(to: CGPoint(x: 10, y: 38)); path.addLine(to: CGPoint(x: 66, y: 38))
                    path.move(to: CGPoint(x: 38, y: 10)); path.addLine(to: CGPoint(x: 38, y: 66))
                }.stroke(gold.opacity(0.2))
                Image(systemName: "arrow.right").font(.system(size: 30, weight: .medium))
                    .rotationEffect(.radians(model.state.aimAngle)).foregroundStyle(gold)
            }.frame(width: 76, height: 76).contentShape(Circle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                    model.state.aim(at: CGPoint(x: value.location.x-38, y: value.location.y-38))
                })
                .accessibilityElement().accessibilityLabel("Bow aim")
                .accessibilityValue("\(Int(model.state.aimPitch)) degrees, \(model.state.facing > 0 ? "right" : "left")")
                .accessibilityAdjustableAction { direction in
                    let angle = model.state.aimAngle + (direction == .increment ? -Double.pi/12 : Double.pi/12)
                    model.state.aim(at: CGPoint(x: cos(angle)*38, y: sin(angle)*38))
                }.accessibilityIdentifier("demo.aim")
            Text("AIM \(Int(model.state.aimPitch))°").font(.system(size: 9, weight: .bold, design: .monospaced))
        }
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
