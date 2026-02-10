import Konva from 'konva'
import type { useSchemaStore } from '~/stores/schema'
import { buildOrthogonalPoints, getPolylineMidpoint } from './orthogonalPath'
import type { Cable } from '~/types/schema'
import { awgToMm2 } from '~/services/cable'

type CableShapeConfig = Konva.ShapeConfig & {
  points: number[]
  cornerRadius: number
  pointerLength: number
  pointerWidth: number
}

const CABLE_POINTER_LENGTH = 10
const CABLE_POINTER_WIDTH = 8
const CABLE_CORNER_RADIUS = 16
const CABLE_WIDTH_SCALE = 0.7 // Adjust this to make all cables thicker (>1.0) or thinner (<1.0)

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

type CanvasCablesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
}

const getCableLineStrokeWidth = (gaugeAwg: number) => {
  console.log(`Calculating stroke width for AWG ${gaugeAwg}`)
  // Convert AWG to cross-sectional area in mm²
  const mm2 = awgToMm2(gaugeAwg)
  const minWidth = 1.5 * CABLE_WIDTH_SCALE
  const maxWidth = 8 * CABLE_WIDTH_SCALE
  
  // Logarithmic mapping: width = minWidth + scale * log(mm2)
  // Using natural log for smooth scaling
  const logMm2 = Math.log(Math.max(mm2, 0.1)) // Prevent log(0)
  const logMin = Math.log(0.5)  // ~AWG 20 territory
  const logMax = Math.log(60)   // ~AWG 00 territory
  // Normalize to 0-1 range
  const normalized = Math.max(0, Math.min(1, (logMm2 - logMin) / (logMax - logMin)))
  
  // Map to width range and round to nearest 0.5 for clean rendering
  const width = minWidth + normalized * (maxWidth - minWidth)
  return Math.round(width * 2) / 2
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

  const ensureCable = (cable: Cable) => {
    const existing = lineMap.get(cable.id)
    if (existing) return existing

    const line = new Konva.Shape<CableShapeConfig>({
      points: [0, 0, 0, 0],
      stroke: '#e64141ff',
      fill: '#e64141ff',
      strokeWidth: getCableLineStrokeWidth(cable.props.gaugeAwg),
      lineCap: 'round',
      lineJoin: 'round',
      hitStrokeWidth: 12,
      id: cable.id,
      cornerRadius: CABLE_CORNER_RADIUS,
      pointerLength: CABLE_POINTER_LENGTH,
      pointerWidth: CABLE_POINTER_WIDTH,
      sceneFunc: (context, shape) => {
        const points = shape.getAttr('points') as number[] | undefined
        if (!points || points.length < 4) return

        const cornerRadius = (shape.getAttr('cornerRadius') as number | undefined) ?? 0

        drawRoundedPath(context, points, cornerRadius)
        context.strokeShape(shape)
      },
    })

    line.on('click tap', (event) => {
      event.cancelBubble = true
      schemaStore.setSelection({ cableId: cable.id })
    })

    lineMap.set(cable.id, line)
    layer.add(line)
    line.zIndex(1)
    return line
  }

  const syncCables = (cables: Cable[]) => {
    cables.forEach((cable) => {
      const line = ensureCable(cable)
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
      const stroke = isSelected ? '#2d2a25' : '#e64141ff'
      line.stroke(stroke)
      line.fill(stroke)
      // line.strokeWidth(isSelected ? 3.5 : 2)
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
