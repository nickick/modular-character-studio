// Modular Character Studio · MIT
import Foundation
import CoreGraphics
import SwiftUI

// Bow-limb deformation and a separately drawn string. Source pixels stay unchanged.
struct BowSpriteDeformation {
    let top, bottom: CGPoint
    let stringHalfWidth: Double

    /// Locate the thin, isolated straight string on the opening side of the sprite.
    /// Work in decoded pixels, then restore the authored crop coordinate system.
    init?(image: CGImage, renderRect: CGRect) {
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width*height*4)
        guard let bitmap = CGContext(data: &pixels, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width*4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        bitmap.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let limit = max(5, Int(Double(width)*0.035))
        var samples: [(x: Double, y: Double, width: Double)] = []
        for y in 0..<height {
            var x = width-1
            while x >= 0 && pixels[(y*width+x)*4+3] < 30 { x -= 1 }
            let end = x
            while x >= 0 && pixels[(y*width+x)*4+3] >= 30 { x -= 1 }
            let start = x+1
            guard end-start > 0, end-start < limit else { continue }
            let gapStart = x
            while x >= 0 && pixels[(y*width+x)*4+3] < 30 { x -= 1 }
            guard x >= 0, gapStart-x > max(5, limit) else { continue }
            samples.append((Double(start+end)/2, Double(y), Double(end-start+1)))
        }
        guard samples.count > max(12, height/6) else { return nil }
        func fit(_ points: [(x: Double, y: Double, width: Double)]) -> (m: Double, b: Double) {
            let n = Double(points.count), mx = points.reduce(0) { $0+$1.x }/n, my = points.reduce(0) { $0+$1.y }/n
            let denominator = points.reduce(0) { $0+($1.y-my)*($1.y-my) }
            let m = points.reduce(0) { $0+($1.y-my)*($1.x-mx) }/max(1, denominator)
            return (m, mx-m*my)
        }
        var line = fit(samples)
        samples = samples.filter { abs($0.x-(line.m*$0.y+line.b)) < Double(limit) }
        guard samples.count > max(12, height/6), let first = samples.first, let last = samples.last,
              last.y-first.y > Double(height)*0.35 else { return nil }
        line = fit(samples)
        let sx = renderRect.width/Double(width), sy = renderRect.height/Double(height)
        func point(_ y: Double) -> CGPoint {
            CGPoint(x: renderRect.minX+(line.m*y+line.b)*sx, y: renderRect.minY+y*sy)
        }
        // Continue through the short string sections beside the limb tips.
        // Stopping at the first isolated run leaves unmoving string stubs/kinks.
        let halfWidth = Int(ceil((samples.map(\.width).max() ?? 4)/2))
        func endpoint(from start: Double, step: Int) -> Double {
            var end = Int(start), y = end+step, empty = 0
            while y >= 0 && y < height {
                let x = Int((line.m*Double(y)+line.b).rounded())
                let lo = max(0, x-halfWidth), hi = min(width-1, x+halfWidth)
                let occupied = lo <= hi && (lo...hi).contains { pixels[(y*width+$0)*4+3] >= 30 }
                if occupied, let seed = (lo...hi).first(where: { pixels[(y*width+$0)*4+3] >= 30 }) {
                    var left = seed, right = seed
                    while left > 0 && pixels[(y*width+left-1)*4+3] >= 30 { left -= 1 }
                    while right < width-1 && pixels[(y*width+right+1)*4+3] >= 30 { right += 1 }
                    // The string ends where it joins the thicker limb wrapping.
                    // Do not move a sliver of the wooden tip with the string.
                    if right-left+1 > max(6, halfWidth*4) { break }
                }
                if occupied { end = y; empty = 0 } else { empty += 1 }
                if empty >= 3 { break }
                y += step
            }
            return Double(end)
        }
        top = point(endpoint(from: first.y, step: -1))
        bottom = point(endpoint(from: last.y, step: 1))
        stringHalfWidth = ((samples.map(\.width).max() ?? 4)/2+2)*sx
    }

    func point(_ source: CGPoint, pivot: CGPoint, progress: Double) -> CGPoint {
        let p = min(1, max(0, progress.isFinite ? progress : 0))
        let span = source.y < pivot.y ? pivot.y-top.y : bottom.y-pivot.y
        let t = min(1, abs(source.y-pivot.y)/max(1, span))
        // Zero displacement and zero slope at the grip. Tips bend toward the archer.
        return CGPoint(x: source.x+140*p*t*t, y: source.y-(source.y-pivot.y)*0.07*p*t)
    }

    func drawBody(context: GraphicsContext, image: GraphicsContext.ResolvedImage,
              renderRect: CGRect, pivot: CGPoint, nock: CGPoint, progress: Double) {
        var keep = Path(renderRect.insetBy(dx: -1, dy: -1))
        keep.move(to: CGPoint(x: top.x-stringHalfWidth, y: top.y))
        keep.addLine(to: CGPoint(x: bottom.x-stringHalfWidth, y: bottom.y))
        keep.addLine(to: CGPoint(x: bottom.x+stringHalfWidth, y: bottom.y))
        keep.addLine(to: CGPoint(x: top.x+stringHalfWidth, y: top.y)); keep.closeSubpath()
        let rows = (0...24).map { renderRect.minY+renderRect.height*Double($0)/24 }
        for i in 0..<rows.count-1 {
            let source = [CGPoint(x: renderRect.minX, y: rows[i]), CGPoint(x: renderRect.maxX, y: rows[i]),
                          CGPoint(x: renderRect.minX, y: rows[i+1]), CGPoint(x: renderRect.maxX, y: rows[i+1])]
            let dest = source.map { point($0, pivot: pivot, progress: progress) }
            for indices in [[0, 1, 2], [1, 3, 2]] {
                let s = indices.map { source[$0] }, d = indices.map { dest[$0] }
                let from = CGAffineTransform(a: s[1].x-s[0].x, b: s[1].y-s[0].y,
                    c: s[2].x-s[0].x, d: s[2].y-s[0].y, tx: s[0].x, ty: s[0].y)
                let to = CGAffineTransform(a: d[1].x-d[0].x, b: d[1].y-d[0].y,
                    c: d[2].x-d[0].x, d: d[2].y-d[0].y, tx: d[0].x, ty: d[0].y)
                var triangle = context
                triangle.clip(to: Path { path in path.move(to: d[0]); path.addLine(to: d[1]); path.addLine(to: d[2]); path.closeSubpath() }, style: FillStyle(antialiased: false))
                triangle.concatenate(from.inverted().concatenating(to))
                triangle.clip(to: keep, style: FillStyle(eoFill: true))
                triangle.draw(image, in: renderRect)
            }
        }
    }

    // Draw in a foreground pass, above the helmet, independently of the bow body.
    func drawString(context: GraphicsContext, image: GraphicsContext.ResolvedImage,
                    renderRect: CGRect, pivot: CGPoint, nock: CGPoint, progress: Double) {
        // The masked original string is a separate textured object, not a replacement stroke.
        // Each half has its own affine strip: limb tip -> nock and nock -> limb tip.
        let t = min(0.95, max(0.05, (nock.y-top.y)/max(1, bottom.y-top.y)))
        let middle = CGPoint(x: top.x+(bottom.x-top.x)*t, y: top.y+(bottom.y-top.y)*t)
        let upper = point(top, pivot: pivot, progress: progress), lower = point(bottom, pivot: pivot, progress: progress)
        for (a, b, c, d) in [(top, middle, upper, nock), (middle, bottom, nock, lower)] {
            func basis(_ start: CGPoint, _ end: CGPoint) -> CGAffineTransform {
                let length = max(1e-8, hypot(end.x-start.x, end.y-start.y))
                return CGAffineTransform(a: (end.y-start.y)/length, b: -(end.x-start.x)/length,
                    c: end.x-start.x, d: end.y-start.y, tx: start.x, ty: start.y)
            }
            let source = basis(a, b), destination = basis(c, d)
            var string = context
            string.concatenate(source.inverted().concatenating(destination))
            let corners = [CGPoint(x: -stringHalfWidth, y: 0), CGPoint(x: stringHalfWidth, y: 0),
                           CGPoint(x: stringHalfWidth, y: 1), CGPoint(x: -stringHalfWidth, y: 1)].map { $0.applying(source) }
            string.clip(to: Path { path in path.move(to: corners[0]); corners.dropFirst().forEach { path.addLine(to: $0) }; path.closeSubpath() })
            string.draw(image, in: renderRect)
        }
    }
}
