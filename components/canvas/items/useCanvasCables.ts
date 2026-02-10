import Konva from 'konva'
import type { useSchemaStore } from '~/stores/schema'
import { buildOrthogonalPoints, getPolylineMidpoint } from './orthogonalPath'

type CableShapeConfig = Konva.ShapeConfig & {
  points: number[]
  cornerRadius: number
  pointerLength: number
  pointerWidth: number
}

const CABLE_POINTER_LENGTH = 10
const CABLE_POINTER_WIDTH = 8
const CABLE_CORNER_RADIUS = 16

const drawRoundedPath = (context, points: number[], radius: number) => {
  if (points.length < 4) return

  context.beginPath()
  context.moveTo(points[0], points[1])

  if (points.length === 4 || radius <= 0) {
    for (let index = 2; index < points.length; index += 2) {
      context.lineTo(points[index], points[index + 1])
    }
    return
  }

  for (let index = 2; index < points.length - 2; index += 2) {
    const prevX = points[index - 2]
    const prevY = points[index - 1]
    const currentX = points[index]
    const currentY = points[index + 1]
    const nextX = points[index + 2]
    const nextY = points[index + 3]

    const lengthIn = Math.hypot(currentX - prevX, currentY - prevY)
    const lengthOut = Math.hypot(nextX - currentX, nextY - currentY)
    const safeRadius = Math.min(radius, lengthIn / 2, lengthOut / 2)

    context.arcTo(currentX, currentY, nextX, nextY, safeRadius)
  }

  context.lineTo(points[points.length - 2], points[points.length - 1])
}

const drawArrowHead = (
  context,
  points: number[],
  pointerLength: number,
  pointerWidth: number,
) => {
  if (points.length < 4 || pointerLength <= 0 || pointerWidth <= 0) return

  const endX = points[points.length - 2]
  const endY = points[points.length - 1]
  const prevX = points[points.length - 4]
  const prevY = points[points.length - 3]

  const angle = Math.atan2(endY - prevY, endX - prevX)
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)

  const leftX = endX - pointerLength * cos + (pointerWidth / 2) * sin
  const leftY = endY - pointerLength * sin - (pointerWidth / 2) * cos
  const rightX = endX - pointerLength * cos - (pointerWidth / 2) * sin
  const rightY = endY - pointerLength * sin + (pointerWidth / 2) * cos

  context.beginPath()
  context.moveTo(endX, endY)
  context.lineTo(leftX, leftY)
  context.lineTo(rightX, rightY)
  context.closePath()
}

type CanvasCablesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
}

export const useCanvasCables = ({ layer, schemaStore }: CanvasCablesOptions) => {
  const lineMap = new Map<string, Konva.Shape>()
  const cableBadgeMap = new Map<string, Konva.Circle>()

  const ensureCableBadge = (cableId: string) => {
    const existing = cableBadgeMap.get(cableId)
    if (existing) return existing

    const badge = new Konva.Circle({
      radius: 5,
      fill: '#f2b46d',
      stroke: '#ffffff',
      strokeWidth: 1,
      visible: false,
    })

    cableBadgeMap.set(cableId, badge)
    layer.add(badge)
    badge.zIndex(2)
    return badge
  }

  const ensureCable = (cableId: string) => {
    const existing = lineMap.get(cableId)
    if (existing) return existing

    const line = new Konva.Shape<CableShapeConfig>({
      points: [0, 0, 0, 0],
      stroke: '#2d2a25',
      fill: '#2d2a25',
      strokeWidth: 2,
      lineCap: 'round',
      lineJoin: 'round',
      hitStrokeWidth: 12,
      id: cableId,
      cornerRadius: CABLE_CORNER_RADIUS,
      pointerLength: CABLE_POINTER_LENGTH,
      pointerWidth: CABLE_POINTER_WIDTH,
      sceneFunc: (context, shape) => {
        const points = shape.getAttr('points') as number[] | undefined
        if (!points || points.length < 4) return

        const cornerRadius = (shape.getAttr('cornerRadius') as number | undefined) ?? 0
        const pointerLength = (shape.getAttr('pointerLength') as number | undefined) ?? 0
        const pointerWidth = (shape.getAttr('pointerWidth') as number | undefined) ?? 0

        drawRoundedPath(context, points, cornerRadius)
        context.strokeShape(shape)

        drawArrowHead(context, points, pointerLength, pointerWidth)
        context.fillStrokeShape(shape)
      },
    })

    line.on('click tap', (event) => {
      event.cancelBubble = true
      schemaStore.setSelection({ cableId })
    })

    lineMap.set(cableId, line)
    layer.add(line)
    line.zIndex(1)
    return line
  }

  const syncCables = (cables: { id: string }[]) => {
    cables.forEach((cable) => {
      const line = ensureCable(cable.id)
      line.zIndex(1)
      ensureCableBadge(cable.id)
    })
  }

  const pruneCables = (currentCableIds: Set<string>) => {
    lineMap.forEach((line, cableId) => {
      if (!currentCableIds.has(cableId)) {
        line.destroy()
        lineMap.delete(cableId)
      }
    })

    cableBadgeMap.forEach((badge, cableId) => {
      if (!currentCableIds.has(cableId)) {
        badge.destroy()
        cableBadgeMap.delete(cableId)
      }
    })
  }

  const syncCableLines = (
    getNodeCenter: (nodeId: string) => { x: number; y: number } | null,
  ) => {
    lineMap.forEach((line, cableId) => {
      const cable = schemaStore.schema.cables.find((item) => item.id === cableId)
      if (!cable) return
      const sourceCenter = getNodeCenter(cable.sourceId)
      const targetCenter = getNodeCenter(cable.targetId)
      if (!sourceCenter || !targetCenter) return
      const points = buildOrthogonalPoints(sourceCenter, targetCenter)
      line.setAttr('points', points)

      const badge = cableBadgeMap.get(cableId)
      if (badge) {
        const midPoint = getPolylineMidpoint(points)
        badge.position(midPoint)
      }
    })
  }

  const applySelection = (selectedCableId: string | undefined) => {
    lineMap.forEach((line, cableId) => {
      const isSelected = cableId === selectedCableId
      const stroke = isSelected ? '#d96b3a' : '#2d2a25'
      line.stroke(stroke)
      line.fill(stroke)
      line.strokeWidth(isSelected ? 3.5 : 2)
    })
  }

  const applyIssueBadges = (cableIssues: Map<string, 'warning' | 'error'>) => {
    cableBadgeMap.forEach((badge, cableId) => {
      const level = cableIssues.get(cableId)
      if (!level) {
        badge.visible(false)
        return
      }
      badge.visible(true)
      badge.fill(level === 'error' ? '#e07a5f' : '#f2b46d')
    })
  }

  return {
    lineMap,
    cableBadgeMap,
    syncCables,
    pruneCables,
    syncCableLines,
    applySelection,
    applyIssueBadges,
  }
}
