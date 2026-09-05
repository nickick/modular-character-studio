/**
 * Painting the assembled rig onto a 2D canvas.
 *
 * Both studios drew the character with their own copy of this pipeline, and the
 * copies had drifted: the equipment studio silently omitted hand-control
 * channels the rig studio already understood. There is one pipeline now, and
 * the differences that are genuinely per-studio -- which item is in the grip,
 * which layers are on show, whether an unsaved preview overrides the keyed
 * values -- arrive as explicit options rather than as closure state.
 */
import { traceBezierPath } from "./bezier.ts"
import { inverse, multiply, transformPoint, type MatrixTable } from "../rig/matrix.ts"
import { deformWeightedMesh, layerLocalMatrix, planeStrips, rigidLayerMatrix, triangleTransform } from "../rig/mesh.ts"
import { posedGripAttachment, type GripControls } from "../rig/grip.ts"
import { worldMatrices } from "../rig/skeleton.ts"
import { mergePoses } from "../rig/clip-poses.ts"
import type { Matrix2D, Point, Pose, ResolvedLayer, ResolvedRig } from "../rig/types.ts"
import { emptyTracks, type RigTracks } from "../rig/tracks.ts"
import { blendBowMatrix, bowNock, bowReloadAt, drawingGrip, solveBowArms } from "../rig/bow-reload.ts"
import { bowStringFor, drawBowBody, drawBowString, straightStringContact, type BowString } from "./bow-string.ts"

/**
 * A decoded image the canvas can draw, with its intrinsic size. Both the
 * `<img>` the browser loads and the `ImageBitmap` an offscreen render uses
 * carry their own dimensions, which is all the painter needs.
 */
export type LayerImage = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas

/** How the caller finds the art for a layer at a moment. */
export type LayerImageLookup = (
  layer: ResolvedLayer,
  animation: string,
  phase: number,
) => LayerImage | null

/** Preserve any transform already on the context around each layer's own. */
function applyMatrix(target: CanvasRenderingContext2D, matrix: Matrix2D): void {
  target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
}

/** Everything the painter needs that is not the rig itself. */
export interface PaintContext {
  rig: ResolvedRig
  animation: string
  phase: number
  tracks?: RigTracks
  images: LayerImageLookup
  /** The held item the closed grip is wrapped around, if any. */
  heldLayer: ResolvedLayer | null
  /** Sampled hand controls for a layer's own side. */
  handControls: (layer: ResolvedLayer) => Partial<GripControls>
  /** Draw joint cages over deformed hands and both boot-ankle pieces. */
  showMesh?: boolean
  /** Fade every layer except this one, for inspecting a single attachment. */
  soloLayerID?: string | null
}

/** The world transforms a paint pass solved, for drawing overlays on top. */
export interface PaintedFrame {
  /** Bind frame that fitted layers are seated against. */
  bindWorld: MatrixTable
  /** Bind frame for mesh cages, which never include unsaved bind edits. */
  meshBindWorld: MatrixTable
  currentWorld: MatrixTable
  pose: Pose
  bowReload?: { layer: ResolvedLayer; image: LayerImage; span: BowString; matrix: Matrix2D; contact: Point; nock: Point | null }
}

/** Seat a layer in the grip stack for the current hand controls. */
export function posedGripLayer(
  layer: ResolvedLayer,
  context: PaintContext,
  controls: Partial<GripControls> = {},
): ResolvedLayer {
  return posedGripAttachment(layer, context.rig.layers, context.heldLayer, controls)
}

function drawRigidLayer(
  target: CanvasRenderingContext2D,
  layer: ResolvedLayer,
  image: LayerImage,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
): void {
  target.save()
  applyMatrix(target, rigidLayerMatrix(layer, image.width, image.height, bindWorld, currentWorld))
  if (traceBezierPath(target, layer.clipPath, image.width, image.height)) target.clip()
  const strips = planeStrips(layer, image.width, image.height)
  if (strips) {
    // A yawed plane is projective and canvas transforms are affine, so it is
    // drawn as vertical strips. Half a pixel of overlap hides the seams.
    for (const strip of strips) {
      target.drawImage(
        image,
        strip.sourceX, 0, strip.sourceWidth, image.height,
        strip.x, strip.y, strip.width + 0.5, strip.height,
      )
    }
  } else {
    target.drawImage(image, 0, 0)
  }
  target.restore()
}

const MESH_STROKE = "rgba(94,226,235,.88)"

function drawMeshLayer(
  target: CanvasRenderingContext2D,
  layer: ResolvedLayer,
  image: LayerImage,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
  showMesh: boolean,
): boolean {
  const deformation = deformWeightedMesh(layer, image.width, image.height, bindWorld, currentWorld)
  if (!deformation) return false
  const corners = (triangle: readonly [number, number, number], from: readonly Point[]) =>
    [from[triangle[0]], from[triangle[1]], from[triangle[2]]] as const
  const sourcePoints = deformation.vertices.map((vertex) => vertex.source)
  for (const triangle of deformation.triangles) {
    const source = corners(triangle, sourcePoints)
    const destination = corners(triangle, deformation.points)
    const matrix = triangleTransform(source, destination)
    if (!matrix) continue
    target.save()
    target.beginPath()
    target.moveTo(destination[0].x, destination[0].y)
    target.lineTo(destination[1].x, destination[1].y)
    target.lineTo(destination[2].x, destination[2].y)
    target.closePath()
    target.clip()
    applyMatrix(target, matrix)
    target.drawImage(image, 0, 0)
    target.restore()
  }
  if (showMesh) {
    target.save()
    target.strokeStyle = MESH_STROKE
    target.lineWidth = 1.25
    for (const triangle of deformation.triangles) {
      const points = corners(triangle, deformation.points)
      target.beginPath()
      target.moveTo(points[0].x, points[0].y)
      target.lineTo(points[1].x, points[1].y)
      target.lineTo(points[2].x, points[2].y)
      target.closePath()
      target.stroke()
    }
    target.restore()
  }
  return true
}

/**
 * Draw one attachment. A layer with a cage deforms; everything else -- which is
 * almost everything on this rig -- is a rigid sprite.
 */
export function drawLayer(
  target: CanvasRenderingContext2D,
  layer: ResolvedLayer,
  image: LayerImage,
  frame: PaintedFrame,
  context: PaintContext,
): void {
  target.save()
  if (context.soloLayerID && layer.id !== context.soloLayerID) target.globalAlpha = 0.26
  const posed = posedGripLayer(layer, context, context.handControls(layer))
  const drewMesh =
    Boolean(layer.mesh) &&
    drawMeshLayer(target, posed, image, frame.meshBindWorld, frame.currentWorld, context.showMesh ?? false)
  if (!drewMesh) {
    drawRigidLayer(target, posed, image, frame.bindWorld, frame.currentWorld)
  }
  target.restore()
}

/** How a paint pass builds its three world frames. */
export interface PoseFrames {
  /** The clip's sampled pose, before any unsaved editor edits. */
  authored: Pose
  /**
   * Unsaved bind-pose edits from a drag in progress. They belong in the fit
   * reference frame as well as the posed one: leaving them out makes a fitted
   * layer -- the torso across hips/spine/chest -- preview a similarity fit
   * whose scale vanishes the moment saving bakes the edits into the bind.
   */
  manual?: Pose
  /**
   * True while edits are scoped to the clip rather than to the skeleton, in
   * which case they are animation and must stay out of the bind frame.
   */
  clipScoped?: boolean
}

export function solveFrames(rig: ResolvedRig, frames: PoseFrames): PaintedFrame {
  const manual = frames.manual ?? {}
  const pose = mergePoses(frames.authored, manual)
  return {
    bindWorld: worldMatrices(rig.bones, frames.clipScoped ? {} : manual),
    meshBindWorld: worldMatrices(rig.bones),
    currentWorld: worldMatrices(rig.bones, pose),
    pose,
  }
}

/** Same procedural reload in the stage, thumbnail picker and equipment preview. */
export function solvePreviewFrames(rig: ResolvedRig, frames: PoseFrames, context: PaintContext,
  stringFor: (image: LayerImage) => BowString | null = bowStringFor,
): PaintedFrame {
  const frame = solveFrames(rig, frames)
  if (context.animation !== "bowReload") return frame
  const layer = rig.layers.find(layer => layer.id === "bow" && layer.visible)
  const image = layer && context.images(layer, context.animation, context.phase)
  const span = image && stringFor(image)
  if (!layer || !image || !span) return frame
  const tracks = context.tracks ?? emptyTracks, timing = bowReloadAt(context.phase)
  const start = worldMatrices(rig.bones, tracks.pose("bowDraw", 1))
  const end = worldMatrices(rig.bones, tracks.pose("bowIdle", 0))
  if (!start.handL || !start.handR) return frame
  const base = Object.fromEntries(Object.keys(start).map(id => [id, blendBowMatrix(start[id], end[id] ?? start[id], timing.settling)]))
  const released = solveBowArms(start, frame.meshBindWorld, rig.bones, 1)
  const reach = 290-timing.retraction
  const front = solveBowArms(base, frame.meshBindWorld, rig.bones, 0, reach)
  const rest = bowNock(front, 0)
  const matrix = rigidLayerMatrix(layer, image.width, image.height, frame.bindWorld, front)
  const straight = transformPoint(matrix, straightStringContact(span, transformPoint(inverse(matrix),rest)))
  const blend = (a:Point,b:Point,t:number):Point => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})
  const releasedGrip = transformPoint(released.handR,drawingGrip)
  const desired = blend(straight,rest,timing.settling)
  const rear = timing.connected ? desired : blend(releasedGrip,straight,timing.reaching)
  const world = timing.reaching === 0 ? released : timing.settling === 1 ? front
    : solveBowArms(base, frame.meshBindWorld, rig.bones, 0, reach, rear)
  const contact = timing.connected ? transformPoint(world.handR,drawingGrip) : straight
  return {...frame,currentWorld:world,bowReload:{layer,image,span,matrix,contact,nock:timing.connected?contact:null}}
}

/**
 * Draw every visible layer in draw order. The caller has already decided which
 * layers are on show, because that answer differs between the two studios.
 */
export function paintLayers(
  target: CanvasRenderingContext2D,
  layers: readonly ResolvedLayer[],
  frame: PaintedFrame,
  context: PaintContext,
): void {
  const ordered = [...layers].sort((left, right) => left.drawOrder - right.drawOrder)
  if (frame.bowReload && layers.some(layer => layer.id === "bow")) {
    paintBowReload(target, ordered, frame, context)
    return
  }
  for (const layer of ordered) {
    const image = context.images(layer, context.animation, context.phase)
    if (!image) continue
    drawLayer(target, layer, image, frame, context)
  }
}

const bowOverlays = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()
function paintBowReload(target: CanvasRenderingContext2D, layers: ResolvedLayer[], frame: PaintedFrame, context: PaintContext) {
  const bow = frame.bowReload!
  const rear = (l: ResolvedLayer) => ["upperArmR","lowerArmR","handR"].includes(l.bone)
  const lead = (l: ResolvedLayer) => ["upperArmL","lowerArmL"].includes(l.bone)
  const hand = (l: ResolvedLayer) => l.bone==="handL" && l.id.startsWith("hand")
  const leg = (l: ResolvedLayer) => l.bone.includes("Leg") || l.bone.startsWith("foot")
  const paint = (l: ResolvedLayer, c=target) => {
    const image=context.images(l,context.animation,context.phase)
    if(image)drawLayer(c,l,image,frame,context)
  }
  layers.filter(lead).forEach(l=>paint(l))
  for(const layer of layers.filter(l=>!lead(l)&&!rear(l)&&!hand(l))) {
    if(layer.id!=="bow"){paint(layer);continue}
    drawBowBody(target,bow.image,bow.matrix,bow.span)
    if(bow.nock) {
      const p=bow.nock
      target.save();target.strokeStyle="#fad177";target.lineWidth=4;target.beginPath()
      target.moveTo(p.x,p.y);target.lineTo(p.x-400,p.y)
      target.moveTo(p.x-380,p.y-10);target.lineTo(p.x-400,p.y);target.lineTo(p.x-380,p.y+10);target.stroke();target.restore()
    }
  }
  let canvas=bowOverlays.get(target.canvas)
  if(!canvas){canvas=document.createElement("canvas");bowOverlays.set(target.canvas,canvas)}
  if(canvas.width!==target.canvas.width)canvas.width=target.canvas.width
  if(canvas.height!==target.canvas.height)canvas.height=target.canvas.height
  const overlay=canvas.getContext("2d")!
  overlay.resetTransform();overlay.clearRect(0,0,canvas.width,canvas.height);overlay.setTransform(target.getTransform())
  drawBowString(overlay,bow.image,bow.matrix,bow.span,bow.contact)
  layers.filter(hand).forEach(l=>paint(l,overlay))
  overlay.globalCompositeOperation="destination-out"
  layers.filter(leg).forEach(l=>paint(l,overlay))
  overlay.globalCompositeOperation="source-over"
  target.save();target.resetTransform();target.drawImage(canvas,0,0);target.restore()
  layers.filter(rear).forEach(l=>paint(l))
}

/**
 * The four corners of a layer's drawn quad, for a selection outline.
 *
 * `bounds` narrows the quad to a region of the source image, which is how the
 * equipment studio boxes an item's painted pixels rather than the mostly
 * transparent artboard it was drawn on.
 */
export function layerCorners(
  layer: ResolvedLayer,
  image: LayerImage,
  frame: PaintedFrame,
  context: PaintContext,
  bounds: { left: number; top: number; right: number; bottom: number } = {
    left: 0,
    top: 0,
    right: image.width,
    bottom: image.height,
  },
): Point[] {
  const matrix = rigidLayerMatrix(
    posedGripLayer(layer, context, context.handControls(layer)),
    image.width,
    image.height,
    frame.bindWorld,
    frame.currentWorld,
  )
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((corner) => transformPoint(matrix, corner))
}

/** Whether a point in stage space lands on a layer's opaque artwork. */
export function layerHitMatrix(
  layer: ResolvedLayer,
  image: LayerImage,
  frame: PaintedFrame,
  context: PaintContext,
): Matrix2D {
  return rigidLayerMatrix(
    posedGripLayer(layer, context, context.handControls(layer)),
    image.width,
    image.height,
    frame.bindWorld,
    frame.currentWorld,
  )
}

/** The bone-local placement matrix, for dragging a layer by its own axes. */
export function layerPlacementMatrix(
  layer: ResolvedLayer,
  image: LayerImage,
  currentWorld: MatrixTable,
): Matrix2D {
  return multiply(currentWorld[layer.bone], layerLocalMatrix(layer, image.width, image.height))
}
