import { NODE_HEIGHT, NODE_WIDTH } from './constants'

export type Point = { x: number; y: number }

type PrimaryAxis = 'auto' | 'horizontal' | 'vertical'

const EPSILON = 0.5

const isAligned = (start: Point, end: Point) =>
  Math.abs(start.x - end.x) < EPSILON || Math.abs(start.y - end.y) < EPSILON

type EdgeAnchor = { point: Point; axis: 'horizontal' | 'vertical' }

const resolveEdgeAnchor = (from: Point, to: Point): EdgeAnchor => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  if (absDx >= absDy) {
    const direction = Math.sign(dx) || 1
    return {
      point: {
        x: from.x + direction * (NODE_WIDTH / 2),
        y: from.y,
      },
      axis: 'horizontal',
    }
  }

  const direction = Math.sign(dy) || 1
  return {
    point: {
      x: from.x,
      y: from.y + direction * (NODE_HEIGHT / 2),
    },
    axis: 'vertical',
  }
}

const getConnectorAnchors = (from: Point, to: Point) => {
  const start = resolveEdgeAnchor(from, to)
  const end = resolveEdgeAnchor(to, from)
  return { start, end }
}

export function getConnectorPoints(from: Point, to: Point) {
  const { start, end } = getConnectorAnchors(from, to)
  return [start.point.x, start.point.y, end.point.x, end.point.y]
}

export const buildOrthogonalPoints = (
  origin: Point,
  target: Point,
  _axis: PrimaryAxis = 'auto',
) => {

  const { start, end } = getConnectorAnchors(origin, target)
  const startPoint = start.point
  const endPoint = end.point

  const sameAxis = start.axis === end.axis
  const isHorizontalLine = Math.abs(startPoint.y - endPoint.y) < EPSILON
  const isVerticalLine = Math.abs(startPoint.x - endPoint.x) < EPSILON
  const directAllowed =
    sameAxis &&
    isAligned(startPoint, endPoint) &&
    ((start.axis === 'horizontal' && isHorizontalLine) ||
      (start.axis === 'vertical' && isVerticalLine))

  if (directAllowed) return [startPoint.x, startPoint.y, endPoint.x, endPoint.y]

  if (sameAxis) {
    if (start.axis === 'horizontal') {
      const midX = (startPoint.x + endPoint.x) / 2
      return [startPoint.x, startPoint.y, midX, startPoint.y, midX, endPoint.y, endPoint.x, endPoint.y]
    }

    const midY = (startPoint.y + endPoint.y) / 2
    return [startPoint.x, startPoint.y, startPoint.x, midY, endPoint.x, midY, endPoint.x, endPoint.y]
  }

  const midX = (startPoint.x + endPoint.x) / 2
  const midY = (startPoint.y + endPoint.y) / 2

  if (start.axis === 'horizontal') {
    return [
      startPoint.x,
      startPoint.y,
      midX,
      startPoint.y,
      midX,
      midY,
      endPoint.x,
      midY,
      endPoint.x,
      endPoint.y,
    ]
  }

  return [
    startPoint.x,
    startPoint.y,
    startPoint.x,
    midY,
    midX,
    midY,
    midX,
    endPoint.y,
    endPoint.x,
    endPoint.y,
  ]
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
