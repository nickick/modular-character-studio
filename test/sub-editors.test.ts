/**
 * The wrist cage and finger cutout editors, checked by behaviour.
 *
 * Both were canvas sub-editors whose logic lived inside pointer handlers, so
 * the old suite could only grep `editor.js` for the fact that they existed.
 * The geometry, hit testing and path operations are pure now, so what they
 * actually do is checkable without a canvas.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { canvasPoint, spriteFrame } from "../src/editor/sprite-frame.ts"
import {
  MAX_BEND_SECTIONS,
  MESH_HANDLE_GRAB_RADIUS,
  MIN_BEND_AXIS,
  MIN_BEND_SECTIONS,
  hitMeshHandle,
  movedMeshHandle,
  resampleSequence,
  setBendSections,
  wristLayerFor,
} from "../src/editor/wrist-mesh.ts"
import {
  addAnchor,
  closePath,
  closesPath,
  deleteNode,
  emptyPath,
  hitPath,
  moveAnchor,
  moveHandle,
  pathStatus,
  shapeNewNode,
  undoAnchor,
} from "../src/editor/bezier-path.ts"
import { weightedStripMesh } from "../src/rig/mesh.ts"
import { resolveProfile } from "../src/rig/skeleton.ts"
import { layerMatchesHandPose } from "../src/rig/clips.ts"
import { validateThreeQuarterRigScene } from "../src/rig/schema.ts"
import type { BezierPathV1, WeightedStripMeshV2 } from "../src/rig/types.ts"

const scenePath = fileURLToPath(
  new URL("../project/scene.json", import.meta.url),
)
const source = JSON.parse(await readFile(scenePath, "utf8"))
const scene = validateThreeQuarterRigScene(structuredClone(source))
const rig = resolveProfile(scene, "maleV1")

// ---------------------------------------------------------------------------
// Sprite framing
// ---------------------------------------------------------------------------

test("a sprite is letterboxed into the panel without distorting it", () => {
  // A wide sprite fits by width and a tall one by height; either way the aspect
  // ratio survives, because the handles are placed against the artwork.
  const wide = spriteFrame(280, 210, 400, 100)
  assert.ok(Math.abs(wide.width / wide.height - 4) < 1e-9)
  assert.ok(wide.width <= 280 - 32 + 1e-9)
  const tall = spriteFrame(280, 210, 100, 400)
  assert.ok(Math.abs(tall.height / tall.width - 4) < 1e-9)
  assert.ok(tall.height <= 210 - 32 + 1e-9)
})

test("panel pixels and normalized sprite space round-trip", () => {
  const frame = spriteFrame(280, 210, 953, 1344)
  for (const at of [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0.5, y: 0.28 },
  ]) {
    const back = frame.normalized(frame.point(at))
    assert.ok(Math.abs(back.x - at.x) < 1e-9 && Math.abs(back.y - at.y) < 1e-9)
  }
})

test("normalized clamps inside the sprite; unbounded lets a handle leave it", () => {
  const frame = spriteFrame(280, 210, 100, 100)
  const outside = { x: -500, y: -500 }
  assert.deepEqual(frame.normalized(outside), { x: 0, y: 0 })
  // Handles may reach outside the artwork while an artist shapes a tight curve.
  assert.ok(frame.unbounded(outside).x < 0)
})

test("a pointer maps into canvas pixels however the canvas is displayed", () => {
  const canvas = {
    width: 280,
    height: 210,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 560, height: 420 }) as DOMRect,
  }
  // Displayed at twice its pixel size, so a pointer travels half as far in it.
  assert.deepEqual(canvasPoint({ clientX: 10, clientY: 20 }, canvas), { x: 0, y: 0 })
  assert.deepEqual(canvasPoint({ clientX: 570, clientY: 440 }, canvas), { x: 280, y: 210 })
})

// ---------------------------------------------------------------------------
// The wrist cage
// ---------------------------------------------------------------------------

const handMesh = (): WeightedStripMeshV2 =>
  structuredClone(
    scene.layers.find((layer) => layer.id === "handClosedL")?.mesh as WeightedStripMeshV2,
  )

test("the studio edits the cage on the hand of the chosen side", () => {
  for (const side of ["L", "R"] as const) {
    const layer = wristLayerFor(rig.layers, side, (candidate) =>
      layerMatchesHandPose(candidate, "closed"),
    )
    assert.ok(layer, `a closed ${side} hand carries a cage`)
    assert.equal(layer.bone, `hand${side}`)
    assert.ok(layer.mesh, "and it is the layer with the mesh on it")
  }
})

test("a handle is grabbed only within reach of where it is drawn", () => {
  const mesh = handMesh()
  const frame = spriteFrame(280, 210, 953, 1344)
  const start = frame.point(mesh.bendStart)
  assert.equal(hitMeshHandle(mesh, frame, start), "bendStart")
  assert.equal(hitMeshHandle(mesh, frame, frame.point(mesh.bendEnd)), "bendEnd")
  const justOutside = { x: start.x + MESH_HANDLE_GRAB_RADIUS + 2, y: start.y }
  assert.equal(hitMeshHandle(mesh, frame, justOutside), null)
})

test("the closer of the two handles wins when they are near each other", () => {
  const mesh: WeightedStripMeshV2 = {
    ...handMesh(),
    bendStart: { x: 0.4, y: 0.4 },
    bendEnd: { x: 0.5, y: 0.4 },
  }
  const frame = spriteFrame(280, 210, 100, 100)
  assert.equal(hitMeshHandle(mesh, frame, frame.point({ x: 0.41, y: 0.4 })), "bendStart")
  assert.equal(hitMeshHandle(mesh, frame, frame.point({ x: 0.49, y: 0.4 })), "bendEnd")
})

test("a handle cannot be dragged onto its partner and collapse the bend axis", () => {
  // A zero-length axis has no direction to blend along, and the mesh builder
  // rejects it outright -- so the drag simply refuses rather than corrupting.
  const mesh = handMesh()
  assert.equal(movedMeshHandle(mesh, "bendStart", { ...mesh.bendEnd }), null)
  const nudged = { x: mesh.bendEnd.x + MIN_BEND_AXIS / 2, y: mesh.bendEnd.y }
  assert.equal(movedMeshHandle(mesh, "bendStart", nudged), null)
  const far = { x: mesh.bendEnd.x, y: mesh.bendEnd.y + MIN_BEND_AXIS * 3 }
  assert.deepEqual(movedMeshHandle(mesh, "bendStart", far), {
    x: Number(far.x.toFixed(4)),
    y: Number(far.y.toFixed(4)),
  })
})

test("a moved handle still builds a mesh the renderer can deform", () => {
  const mesh = handMesh()
  const moved = movedMeshHandle(mesh, "bendEnd", { x: 0.5, y: 0.62 })
  assert.ok(moved)
  const geometry = weightedStripMesh({ ...mesh, bendEnd: moved }, 953, 1344)
  assert.ok(geometry && geometry.vertices.length >= 6)
  assert.equal(geometry.vertices.length, geometry.stationValues.length * 2, "two rails per station")
})

test("changing the section count keeps the shape of the existing distribution", () => {
  // Raising the density around an already-tuned bend must not reset it to an
  // even spread and undo the tuning.
  const uneven = [0, 0.1, 0.15, 1]
  const denser = resampleSequence(uneven, 7)
  assert.equal(denser.length, 7)
  assert.equal(denser[0], 0)
  assert.equal(denser.at(-1), 1)
  for (let index = 1; index < denser.length; index += 1) {
    assert.ok(denser[index] > denser[index - 1], "stops stay strictly increasing")
  }
  // The bunching near the start survives: the first half still covers less
  // ground than the second.
  assert.ok(denser[3] < 0.5, "the tuned bunching is preserved")
})

test("the section count is clamped to what the cage supports", () => {
  const low = handMesh()
  setBendSections(low, 1)
  assert.equal(low.bendStops.length, MIN_BEND_SECTIONS)
  const high = handMesh()
  setBendSections(high, 99)
  assert.equal(high.bendStops.length, MAX_BEND_SECTIONS)
  const same = handMesh()
  assert.equal(setBendSections(same, same.bendStops.length), false, "no change is not an edit")
})

test("every resampled cage still passes the scene schema", () => {
  for (let count = MIN_BEND_SECTIONS; count <= MAX_BEND_SECTIONS; count += 1) {
    const draft = structuredClone(source)
    const layer = draft.layers.find((candidate: { id: string }) => candidate.id === "handClosedL")
    setBendSections(layer.mesh, count)
    assert.doesNotThrow(() => validateThreeQuarterRigScene(draft), `${count} sections validates`)
  }
})

// ---------------------------------------------------------------------------
// The finger cutout
// ---------------------------------------------------------------------------

const identity = (point: { x: number; y: number }) => point

test("the pen adds corners, and a path only closes once it encloses something", () => {
  let path = emptyPath()
  assert.equal(path.closed, false)
  path = addAnchor(path, { x: 0.1, y: 0.1 })
  path = addAnchor(path, { x: 0.9, y: 0.1 })
  assert.equal(closePath(path).closed, false, "two anchors enclose nothing")
  path = addAnchor(path, { x: 0.5, y: 0.9 })
  assert.equal(closePath(path).closed, true)
})

test("clicking the first anchor is what closes the path", () => {
  let path = emptyPath()
  for (const at of [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }]) {
    path = addAnchor(path, at)
  }
  assert.equal(closesPath(path, identity, { x: 0.1, y: 0.1 }), true)
  assert.equal(closesPath(path, identity, { x: 50, y: 50 }), false, "elsewhere does not close it")
  assert.equal(
    closesPath({ ...path, closed: true }, identity, { x: 0.1, y: 0.1 }),
    false,
    "an already-closed path cannot close again",
  )
  assert.equal(closesPath(null, identity, { x: 0, y: 0 }), false)
})

test("dragging from a fresh anchor grows a mirrored pair of handles", () => {
  const anchor = { x: 0.5, y: 0.5 }
  const path = shapeNewNode(addAnchor(emptyPath(), anchor), 0, anchor, { x: 0.6, y: 0.5 })
  const node = path.nodes[0]
  assert.deepEqual(node.out, { x: 0.6, y: 0.5 })
  // The incoming handle mirrors through the anchor, which is what makes the
  // curve smooth rather than kinked.
  assert.deepEqual(node.in, { x: 0.4, y: 0.5 })
})

test("moving an anchor carries its handles so the curve keeps its shape", () => {
  const original = { x: 0.5, y: 0.5, in: { x: 0.4, y: 0.5 }, out: { x: 0.6, y: 0.5 } }
  const path: BezierPathV1 = { type: "bezierPathV1", closed: false, nodes: [original] }
  const moved = moveAnchor(path, 0, original, { x: 0.1, y: -0.2 })
  const node = moved.nodes[0]
  assert.deepEqual({ x: node.x, y: node.y }, { x: 0.6, y: 0.3 })
  assert.deepEqual(node.in, { x: 0.5, y: 0.3 })
  assert.deepEqual(node.out, { x: 0.7, y: 0.3 })
})

test("an anchor cannot be dragged outside the sprite", () => {
  const original = { x: 0.5, y: 0.5 }
  const path: BezierPathV1 = { type: "bezierPathV1", closed: false, nodes: [original] }
  const moved = moveAnchor(path, 0, original, { x: 5, y: -5 }).nodes[0]
  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 1, y: 0 })
})

test("a handle mirrors through its anchor unless the drag breaks the pair", () => {
  const path: BezierPathV1 = {
    type: "bezierPathV1",
    closed: false,
    nodes: [{ x: 0.5, y: 0.5, in: { x: 0.4, y: 0.5 }, out: { x: 0.6, y: 0.5 } }],
  }
  const smooth = moveHandle(path, 0, "out", { x: 0.7, y: 0.6 }, false).nodes[0]
  assert.deepEqual(smooth.out, { x: 0.7, y: 0.6 })
  assert.deepEqual(smooth.in, { x: 0.3, y: 0.4 }, "the partner mirrors through the anchor")
  // Option-dragging breaks the pair, which is how a corner gets a kink.
  const broken = moveHandle(path, 0, "out", { x: 0.7, y: 0.6 }, true).nodes[0]
  assert.deepEqual(broken.in, { x: 0.4, y: 0.5 }, "the partner stays where it was")
})

test("the selected node's handles are grabbed before any anchor", () => {
  const path: BezierPathV1 = {
    type: "bezierPathV1",
    closed: false,
    nodes: [
      { x: 10, y: 10, in: { x: 4, y: 10 }, out: { x: 16, y: 10 } },
      { x: 100, y: 100 },
    ],
  }
  assert.deepEqual(hitPath(path, 0, identity, { x: 16, y: 10 }), {
    kind: "handle",
    index: 0,
    handle: "out",
  })
  assert.deepEqual(hitPath(path, 0, identity, { x: 100, y: 100 }), { kind: "anchor", index: 1 })
  assert.equal(hitPath(path, 0, identity, { x: 500, y: 500 }), null, "empty space grabs nothing")
  // A handle only counts while its own node is selected, so a stray click near
  // an unselected node's handle picks the anchor rather than the handle.
  assert.deepEqual(hitPath(path, 1, identity, { x: 12, y: 10 }), { kind: "anchor", index: 0 })
})

test("deleting below three anchors reopens the path", () => {
  const path: BezierPathV1 = {
    type: "bezierPathV1",
    closed: true,
    nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  }
  const result = deleteNode(path, 1)
  assert.equal(result.path?.nodes.length, 2)
  assert.equal(result.path?.closed, false, "two anchors cannot enclose anything")
  assert.equal(result.selected, 1, "selection follows the surviving neighbour")
})

test("deleting the last anchor clears the cutout entirely", () => {
  const path: BezierPathV1 = { type: "bezierPathV1", closed: false, nodes: [{ x: 0, y: 0 }] }
  const result = deleteNode(path, 0)
  assert.equal(result.path, null)
  assert.equal(result.selected, null)
})

test("undo point takes back the anchor that was placed last", () => {
  let path = emptyPath()
  for (const at of [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }]) path = addAnchor(path, at)
  const result = undoAnchor(path)
  assert.deepEqual(result.path?.nodes.map((node) => node.x), [0.1])
  assert.equal(undoAnchor(emptyPath()).path, null)
})

test("an authored cutout still passes the scene schema on every finger", () => {
  let path = emptyPath()
  for (const at of [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.15 }, { x: 0.7, y: 0.9 }]) {
    path = addAnchor(path, at)
  }
  path = shapeNewNode(path, 1, path.nodes[1], { x: 0.9, y: 0.4 })
  const closed = closePath(path)
  const draft = structuredClone(source)
  for (const id of ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"]) {
    draft.layers.find((layer: { id: string }) => layer.id === id).clipPath = structuredClone(closed)
  }
  const validated = validateThreeQuarterRigScene(draft)
  const stored = validated.layers.find((layer) => layer.id === "handClosedLPinky")?.clipPath
  assert.equal(stored?.closed, true)
  assert.equal(stored?.nodes.length, 3)
  assert.deepEqual(stored?.nodes[1].out, { x: 0.9, y: 0.4 }, "the authored handles survive a save")
})

test("the status line says what the path needs next", () => {
  assert.match(pathStatus(null), /Click to add corners/)
  assert.match(pathStatus({ type: "bezierPathV1", closed: false, nodes: [{ x: 0, y: 0 }] }), /1 anchor\b/)
  assert.match(
    pathStatus({ type: "bezierPathV1", closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    /2 anchors/,
  )
  assert.match(
    pathStatus({ type: "bezierPathV1", closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }),
    /closed cutout/,
  )
})
