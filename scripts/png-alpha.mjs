import { inflateSync } from 'node:zlib'

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const channelsByColorType = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
])

const paeth = (left, up, upperLeft) => {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

export const decodePngAlpha = (buffer) => {
  if (!buffer.subarray(0, signature.length).equals(signature)) throw new Error('invalid PNG signature')

  let offset = signature.length
  let header
  const compressed = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > buffer.length) throw new Error(`truncated PNG ${type} chunk`)
    const data = buffer.subarray(start, end)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') compressed.push(data)
    offset = end + 4
    if (type === 'IEND') break
  }

  if (!header || compressed.length === 0) throw new Error('missing PNG image data')
  const channels = channelsByColorType.get(header.colorType)
  if (header.bitDepth !== 8 || !channels || header.interlace !== 0) {
    throw new Error(`unsupported PNG format: depth=${header.bitDepth}, color=${header.colorType}, interlace=${header.interlace}`)
  }

  const stride = header.width * channels
  const raw = inflateSync(Buffer.concat(compressed))
  if (raw.length !== header.height * (stride + 1)) throw new Error('invalid PNG scanline length')
  const pixels = new Uint8Array(header.height * stride)
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    const target = y * stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]
      const left = x >= channels ? pixels[target + x - channels] : 0
      const up = y > 0 ? pixels[target + x - stride] : 0
      const upperLeft = y > 0 && x >= channels ? pixels[target + x - stride - channels] : 0
      if (filter === 0) pixels[target + x] = value
      else if (filter === 1) pixels[target + x] = value + left
      else if (filter === 2) pixels[target + x] = value + up
      else if (filter === 3) pixels[target + x] = value + Math.floor((left + up) / 2)
      else if (filter === 4) pixels[target + x] = value + paeth(left, up, upperLeft)
      else throw new Error(`unsupported PNG filter ${filter}`)
    }
  }

  const alpha = new Uint8Array(header.width * header.height)
  const alphaChannel = header.colorType === 6 ? 3 : header.colorType === 4 ? 1 : null
  alpha.fill(255)
  if (alphaChannel !== null) {
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = pixels[index * channels + alphaChannel]
    }
  }
  return { ...header, alpha }
}

export const analyzeAlpha = ({ width, height, alpha }, threshold = 8) => {
  const visited = new Uint8Array(alpha.length)
  const components = []
  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || alpha[start] <= threshold) continue
    visited[start] = 1
    const stack = [start]
    let area = 0
    let left = width
    let top = height
    let right = 0
    let bottom = 0
    while (stack.length) {
      const current = stack.pop()
      const x = current % width
      const y = Math.floor(current / width)
      area += 1
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x + 1)
      bottom = Math.max(bottom, y + 1)
      for (let neighbourY = Math.max(0, y - 1); neighbourY < Math.min(height, y + 2); neighbourY += 1) {
        for (let neighbourX = Math.max(0, x - 1); neighbourX < Math.min(width, x + 2); neighbourX += 1) {
          const neighbour = neighbourY * width + neighbourX
          if (!visited[neighbour] && alpha[neighbour] > threshold) {
            visited[neighbour] = 1
            stack.push(neighbour)
          }
        }
      }
    }
    components.push({ area, box: [left, top, right, bottom] })
  }
  components.sort((a, b) => b.area - a.area)
  const bounds = components.length
    ? components.reduce(([left, top, right, bottom], component) => [
      Math.min(left, component.box[0]),
      Math.min(top, component.box[1]),
      Math.max(right, component.box[2]),
      Math.max(bottom, component.box[3]),
    ], [...components[0].box])
    : null
  return { bounds, components }
}

export const remoteAlphaComponents = (analysis, minimumGap = 4) => {
  if (analysis.components.length < 2) return []
  const [left, top, right, bottom] = analysis.components[0].box
  return analysis.components.slice(1).filter(({ box }) => {
    const horizontalGap = Math.max(left - box[2], box[0] - right, 0)
    const verticalGap = Math.max(top - box[3], box[1] - bottom, 0)
    return Math.max(horizontalGap, verticalGap) > minimumGap
  })
}
