import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

test('Swift slice resolves strikes, arrows, cancellation, guarding, dodge, and switching', { skip: process.platform !== 'darwin' }, async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'mcs-swift-simulation-'))
  try {
    const source = await readFile(new URL('../examples/ios/PlateDemo.swift', import.meta.url), 'utf8')
    const simulation = source.slice(source.indexOf('struct DemoArrow'), source.indexOf('@MainActor'))
    const assertions = `
func advance(_ state: inout DemoSimulation, _ seconds: Double) {
    for _ in 0..<Int(seconds * 60) { state.advance(1.0 / 60, durations: ["swordSwing": 1.05]) }
}
var melee = DemoSimulation(); melee.playerX = 420
melee.beginAttack(); melee.releaseAttack(); advance(&melee, 0.7)
assert(melee.hits == 1 && melee.hitFlashUntil > 0)
advance(&melee, 0.6); assert(melee.hits == 1 && melee.action == nil)
melee.setMode(.bow); assert(melee.clip == "bowIdle" && !melee.guarding)
melee.beginAttack(); advance(&melee, 1.3); melee.releaseAttack()
assert(melee.arrows.count == 1); advance(&melee, 0.5)
assert(melee.hits == 2 && melee.arrows.isEmpty)
var cancelled = DemoSimulation(); cancelled.beginAttack(); cancelled.cancelled = true; cancelled.releaseAttack()
assert(cancelled.action == nil && cancelled.arrows.isEmpty)
cancelled.beginAttack(); cancelled.setMode(.bow); cancelled.releaseAttack()
assert(cancelled.attackHeldAt == nil && cancelled.arrows.isEmpty)
var guardTest = DemoSimulation(); guardTest.guarding = true
assert(guardTest.clip == "shieldUp")
guardTest.movement = 1; assert(guardTest.clip == "shieldMoveForward")
guardTest.setMode(.bow); assert(!guardTest.guarding && guardTest.clip == "bowIdle")
var dodge = DemoSimulation(); dodge.playerX = 420; dodge.dodge()
advance(&dodge, 0.2); assert(dodge.isDodging && dodge.playerX > 420)
let began = dodge.actionBegan; dodge.dodge(); assert(dodge.actionBegan == began)
var joystick = DemoHorizontalJoystick()
joystick.begin(at: CGPoint(x: 200, y: 250)); assert(joystick.value == 0)
joystick.move(to: CGPoint(x: 200, y: 600)); assert(joystick.value == 0 && joystick.cursor?.y == 250)
joystick.move(to: CGPoint(x: 220, y: 900)); assert(abs(joystick.value - 20.0 / 37) < 0.0001)
joystick.move(to: CGPoint(x: 500, y: 0)); assert(joystick.value == 1 && joystick.cursor?.y == 250)
joystick.move(to: CGPoint(x: 0, y: 100)); assert(joystick.value == -1)
joystick.end(); assert(joystick.value == 0 && joystick.origin == nil)
joystick.begin(at: CGPoint(x: 70, y: 50)); joystick.move(to: CGPoint(x: 107, y: 400))
assert(joystick.value == 1 && joystick.cursor?.y == 50)
joystick.end()
var movement = DemoSimulation(); movement.movement = -1; advance(&movement, 2)
assert(movement.playerX >= 55 && movement.facing == -1)
var aimed = DemoSimulation(); aimed.setMode(.bow)
aimed.aim(at: CGPoint(x: 30, y: -30)); assert(abs(aimed.aimPitch + 45) < 0.001 && aimed.facing == 1)
aimed.beginAttack(); aimed.releaseAttack(origin: CGPoint(x: 300, y: -300))
assert(aimed.arrows[0].y == -300 && aimed.arrows[0].dy < 0)
advance(&aimed, 0.5); assert(aimed.hits == 0)
aimed.aim(at: CGPoint(x: -30, y: 30)); assert(abs(aimed.aimPitch - 45) < 0.001 && aimed.facing == -1)
aimed.beginAttack(); aimed.releaseAttack(); assert(aimed.arrows.last!.dx < 0 && aimed.arrows.last!.dy > 0)
let angle = aimed.aimAngle; aimed.aim(at: CGPoint(x: 0, y: 0)); assert(aimed.aimAngle == angle)
var sweep = DemoSimulation(); sweep.arrows = [DemoArrow(x: 500, y: -220, dx: 1, dy: 0)]
sweep.advance(0.1, durations: [:]); assert(sweep.hits == 1 && sweep.arrows.isEmpty)
print("Swift simulation checks passed")
`
    const swift = resolve(temp, 'main.swift'), binary = resolve(temp, 'checks')
    await writeFile(swift, 'import Foundation\n' + simulation + assertions)
    execFileSync('xcrun', ['swiftc', '-module-cache-path', resolve(temp, 'cache'), swift, '-o', binary], { encoding: 'utf8', timeout: 60000 })
    assert.match(execFileSync(binary, { encoding: 'utf8' }), /checks passed/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
