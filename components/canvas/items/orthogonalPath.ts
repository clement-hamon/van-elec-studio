export type Point = { x: number; y: number }

type PrimaryAxis = 'auto' | 'horizontal' | 'vertical'

const EPSILON = 0.5

const isAligned = (start: Point, end: Point) =>
  Math.abs(start.x - end.x) < EPSILON || Math.abs(start.y - end.y) < EPSILON

const resolveAxis = (start: Point, end: Point, axis: PrimaryAxis): 'horizontal' | 'vertical' => {
  if (axis !== 'auto') return axis
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical'
}

export const buildOrthogonalPoints = (
  start: Point,
  end: Point,
  axis: PrimaryAxis = 'auto',
) => {
  if (isAligned(start, end)) {
    return [start.x, start.y, end.x, end.y]
  }

  const resolvedAxis = resolveAxis(start, end, axis)

  if (resolvedAxis === 'horizontal') {
    const midX = (start.x + end.x) / 2
    return [start.x, start.y, midX, start.y, midX, end.y, end.x, end.y]
  }

  const midY = (start.y + end.y) / 2
  return [start.x, start.y, start.x, midY, end.x, midY, end.x, end.y]
}

export const getPolylineMidpoint = (points: number[]) => {
  if (points.length < 4) return { x: 0, y: 0 }

  let totalLength = 0
  for (let index = 0; index < points.length - 2; index += 2) {
    const dx = points[index + 2] - points[index]
    const dy = points[index + 3] - points[index + 1]
    totalLength += Math.hypot(dx, dy)
  }

  let remaining = totalLength / 2
  for (let index = 0; index < points.length - 2; index += 2) {
    const x1 = points[index]
    const y1 = points[index + 1]
    const x2 = points[index + 2]
    const y2 = points[index + 3]
    const segmentLength = Math.hypot(x2 - x1, y2 - y1)

    if (segmentLength === 0) continue

    if (remaining <= segmentLength) {
      const ratio = remaining / segmentLength
      return {
        x: x1 + (x2 - x1) * ratio,
        y: y1 + (y2 - y1) * ratio,
      }
    }

    remaining -= segmentLength
  }

  return {
    x: points[points.length - 2],
    y: points[points.length - 1],
  }
}
