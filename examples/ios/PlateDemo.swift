// Modular Character Studio · MIT. Generated resources carry their own CC0 notice.
// A small SwiftUI/CoreGraphics slice inspired by Den Hunter's rig playback and
// shared attack pad, melee/ranged switch, hold-to-block, and dodge action bar.
import SwiftUI
import UIKit
import Combine

@main
struct PlateDemoApp: App {
    var body: some Scene { WindowGroup { PlateDemoView() } }
}

// MARK: - Portable exported data

struct DemoAsset: Decodable { let path: String; let width, height: Double }
struct DemoEquipment: Decodable { let id, label: String }
struct DemoCanvas: Decodable { let width, height: Double }
struct DemoPoint: Decodable { let x, y: Double }
struct DemoNode: Decodable {
    let x, y: Double
    let `in`, out: DemoPoint?
}
struct DemoCutout: Decodable { let closed: Bool; let nodes: [DemoNode] }
struct DemoStrip: Decodable { let sourceX, sourceWidth, x, width, y, height: Double }
struct DemoAttachment: Decodable {
    let id: String
    let asset: Int
    let source: [Double]?
    let triangles: [Int]?
    let clipPath: DemoCutout?
    let strips: [DemoStrip]?
}
struct DemoLayerFrame: Decodable { let attachment: Int; let values: [Double] }
struct DemoClip: Decodable {
    let duration: Double
    let loops, endKeyed: Bool
    let frames: [[DemoLayerFrame]]
}
struct DemoManifest: Decodable {
    let format, profile: String
    let canvas: DemoCanvas
    let baseline: Double
    let loadout: [String: DemoEquipment]
    let assets: [DemoAsset]
    let attachments: [DemoAttachment]
    let clips: [String: String]
}

final class DemoLibrary {
    let manifest: DemoManifest
    let clips: [String: DemoClip]
    let images: [UIImage]

    init(bundle: Bundle = .main) throws {
        guard let root = bundle.resourceURL?.appendingPathComponent("CharacterRuntime") else {
            throw NSError(domain: "PlateDemo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Add the exported CharacterRuntime folder to the app target."])
        }
        let decoder = JSONDecoder()
        let manifest = try decoder.decode(DemoManifest.self, from: Data(contentsOf: root.appendingPathComponent("runtime.json")))
        guard manifest.format == "modular-character-studio-ios-demo-v1" else {
            throw NSError(domain: "PlateDemo", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsupported runtime export. Run npm run export:ios again."])
        }
        self.manifest = manifest
        clips = try manifest.clips.mapValues { path in
            let clip = try decoder.decode(DemoClip.self, from: Data(contentsOf: root.appendingPathComponent(path)))
            guard clip.duration > 0, clip.frames.count >= 2 else {
                throw NSError(domain: "PlateDemo", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid animation: \(path)"])
            }
            for frame in clip.frames {
                for layer in frame {
                    guard manifest.attachments.indices.contains(layer.attachment), layer.values.allSatisfy(\.isFinite) else {
                        throw NSError(domain: "PlateDemo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Invalid attachment geometry in \(path)"])
                    }
                    let attachment = manifest.attachments[layer.attachment]
                    let expected = attachment.source?.count ?? 6
                    guard layer.values.count == expected, manifest.assets.indices.contains(attachment.asset),
                          (attachment.triangles ?? []).allSatisfy({ $0 >= 0 && $0 * 2 + 1 < expected }) else {
                        throw NSError(domain: "PlateDemo", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid mesh in \(path)"])
                    }
                }
            }
            return clip
        }
        images = try manifest.assets.map { asset in
            guard let image = UIImage(contentsOfFile: root.appendingPathComponent(asset.path).path) else {
                throw NSError(domain: "PlateDemo", code: 6, userInfo: [NSLocalizedDescriptionKey: "Missing texture: \(asset.path)"])
            }
            return image
        }
    }
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
    let library: DemoLibrary?
    private var lastTime: TimeInterval?
    private var clipBegan = 0.0
    private var previousClip = "idle"
    private var previousActionBegan = -1.0
    var phase = 0.0
    var durations: [String: Double] { library?.clips.mapValues(\.duration) ?? [:] }

    init() {
        do { library = try DemoLibrary() }
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
        phase = library?.clips[next.clip]?.loops == true ? raw.truncatingRemainder(dividingBy: 1) : min(1, raw)
        state = next
    }
    func pause() { state.releaseInputs(); lastTime = nil; inputGeneration += 1 }
    func reset() { inputGeneration += 1; state = DemoSimulation(); phase = 0; previousClip = "idle"; clipBegan = 0; previousActionBegan = -1; lastTime = nil }
}

// MARK: - Native drawing: sampled matrices and triangle deformation, not spritesheets

struct DemoStage: UIViewRepresentable {
    let library: DemoLibrary
    let state: DemoSimulation
    let phase: Double
    func makeUIView(context: Context) -> DemoStageView { DemoStageView() }
    func updateUIView(_ view: DemoStageView, context: Context) {
        view.library = library; view.state = state; view.phase = phase; view.setNeedsDisplay()
    }
}

final class DemoStageView: UIView {
    var library: DemoLibrary?
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
        // Preserve the original 1254-point logical artboard and authored baseline.
        context.scaleBy(x: -0.36 * scale * state.facing, y: 0.36 * scale)
        context.translateBy(x: -library.manifest.canvas.width / 2, y: -library.manifest.baseline)
        drawCharacter(context, library: library)
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

    private func drawCharacter(_ context: CGContext, library: DemoLibrary) {
        guard let clip = library.clips[state.clip] else { return }
        let sample = max(0, min(1, phase)) * Double(clip.frames.count - 1)
        let index = Int(sample), next = min(index + 1, clip.frames.count - 1)
        let fraction = !clip.endKeyed && next == clip.frames.count - 1 ? 0 : sample - Double(index)
        for (position, current) in clip.frames[index].enumerated() {
            let attachment = library.manifest.attachments[current.attachment]
            var values = current.values
            if clip.frames[next].indices.contains(position) {
                let following = clip.frames[next][position]
                if following.attachment == current.attachment && following.values.count == values.count {
                    values = zip(values, following.values).map { $0 + ($1 - $0) * fraction }
                }
            }
            let asset = library.manifest.assets[attachment.asset], image = library.images[attachment.asset]
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
