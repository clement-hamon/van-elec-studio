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
// const CABLE_GAUGE_HINT_FONT_SIZE = 14
// const CABLE_GAUGE_HINT_COLOR = '#e64141ff'
// const CABLE_GAUGE_HINT_BG = '#F9F7F2'
// const CABLE_GAUGE_HINT_PADDING_X = 6
// const CABLE_GAUGE_HINT_PADDING_Y = 3
// const CABLE_GAUGE_HINT_RADIUS = 6
const CABLE_FLOW_FONT_SIZE = 12
const CABLE_FLOW_COLOR = '#2d2a25'
const CABLE_FLOW_BG = '#fffaf2'
const CABLE_FLOW_PADDING_X = 6
const CABLE_FLOW_PADDING_Y = 2
const CABLE_FLOW_RADIUS = 6
const CABLE_FLOW_OFFSET = 14

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

const getPolylineMidpointWithAngle = (points: number[]) => {
  if (points.length < 4) return { x: 0, y: 0, angle: 0 }

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
      const isVertical = Math.abs(y2 - y1) > Math.abs(x2 - x1)
      return {
        x: x1 + (x2 - x1) * ratio,
        y: y1 + (y2 - y1) * ratio,
        angle: isVertical ? 90 : 0,
      }
    }

    remaining -= segmentLength
  }

  return {
    x: points[points.length - 2],
    y: points[points.length - 1],
    angle: 0,
  }
}

type CanvasCablesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
}

const getCableLineStrokeWidth = (gaugeAwg: number) => {
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
  const cableGaugeMap = new Map<string, Konva.Group>()
  const cableFlowMap = new Map<string, Konva.Group>()

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

  // const ensureCableGaugeLabel = (cable: Cable) => {
  //   const existing = cableGaugeMap.get(cable.id)
  //   if (existing) return existing

  //   const label = new Konva.Group({
  //     listening: false,
  //   })

  //   const background = new Konva.Rect({
  //     fill: CABLE_GAUGE_HINT_BG,
  //     opacity: 0.9,
  //     cornerRadius: CABLE_GAUGE_HINT_RADIUS,
  //     listening: false,
  //     name: 'cable-gauge-bg',
  //   })

  //   const text = new Konva.Text({
  //     text: `⌀${cable.wire.gaugeAwg ?? 0}`,
  //     fontSize: CABLE_GAUGE_HINT_FONT_SIZE,
  //     fontFamily: 'Space Grotesk, sans-serif',
  //     fill: CABLE_GAUGE_HINT_COLOR,
  //     stroke: CABLE_GAUGE_HINT_COLOR,
  //     strokeWidth: 1,
  //     opacity: 0.9,
  //     listening: false,
  //     name: 'cable-gauge-text',
  //   })

  //   label.add(background)
  //   label.add(text)

  //   cableGaugeMap.set(cable.id, label)
  //   layer.add(label)
  //   label.zIndex(2)
  //   return label
  // }

  const ensureCableFlowLabel = (cable: Cable) => {
    const existing = cableFlowMap.get(cable.id)
    if (existing) return existing

    const label = new Konva.Group({
      listening: false,
    })

    const background = new Konva.Rect({
      fill: CABLE_FLOW_BG,
      opacity: 0.92,
      cornerRadius: CABLE_FLOW_RADIUS,
      listening: false,
      name: 'cable-flow-bg',
    })

    const text = new Konva.Text({
      text: '0.0A',
      fontSize: CABLE_FLOW_FONT_SIZE,
      fontFamily: 'Space Grotesk, sans-serif',
      fill: CABLE_FLOW_COLOR,
      listening: false,
      name: 'cable-flow-text',
    })

    label.add(background)
    label.add(text)

    cableFlowMap.set(cable.id, label)
    layer.add(label)
    label.zIndex(2)
    return label
  }

  const ensureCable = (cable: Cable) => {
    const existing = lineMap.get(cable.id)
    if (existing) return existing

    const line = new Konva.Shape<CableShapeConfig>({
      points: [0, 0, 0, 0],
      stroke: '#e64141ff',
      fill: '#e64141ff',
      strokeWidth: getCableLineStrokeWidth(cable.wire.gaugeAwg ?? 0),
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
      line.strokeWidth(getCableLineStrokeWidth(cable.wire.gaugeAwg ?? 0))
      line.zIndex(1)
      ensureCableBadge(cable.id)
      // ensureCableGaugeLabel(cable)
      ensureCableFlowLabel(cable)
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

    cableGaugeMap.forEach((label, cableId) => {
      if (!currentCableIds.has(cableId)) {
        label.destroy()
        cableGaugeMap.delete(cableId)
      }
    })

    cableFlowMap.forEach((label, cableId) => {
      if (!currentCableIds.has(cableId)) {
        label.destroy()
        cableFlowMap.delete(cableId)
      }
    })
  }



  const syncCableLines = (
    getNodeCenter: (nodeId: string) => { x: number; y: number } | null,
  ) => {
    lineMap.forEach((line, cableId) => {
      const cable = schemaStore.schema.cables.find((item) => item.id === cableId)
      if (!cable) return
      const sourceCenter = getNodeCenter(cable.from.nodeId)
      const targetCenter = getNodeCenter(cable.to.nodeId)

      if (!sourceCenter || !targetCenter) return
      
      const points = buildOrthogonalPoints(sourceCenter, targetCenter)
      line.setAttr('points', points)

      const badge = cableBadgeMap.get(cableId)
      const midPoint = getPolylineMidpoint(points)
      if (badge) badge.position(midPoint)

      const gaugeLabel = cableGaugeMap.get(cableId)
      if (gaugeLabel) {
        const textNode = gaugeLabel.findOne<Konva.Text>('.cable-gauge-text')
        const backgroundNode = gaugeLabel.findOne<Konva.Rect>('.cable-gauge-bg')
        if (!textNode || !backgroundNode) return
        const gaugeText = `⌀${cable.wire.gaugeAwg ?? 0}`
        if (textNode.text() !== gaugeText) textNode.text(gaugeText)
        const { x, y, angle } = getPolylineMidpointWithAngle(points)
        const textWidth = textNode.getTextWidth()
        const textHeight = textNode.height() || textNode.fontSize()
        const paddedWidth = textWidth + CABLE_GAUGE_HINT_PADDING_X * 2
        const paddedHeight = textHeight + CABLE_GAUGE_HINT_PADDING_Y * 2
        backgroundNode.size({ width: paddedWidth, height: paddedHeight })
        textNode.position({ x: CABLE_GAUGE_HINT_PADDING_X, y: CABLE_GAUGE_HINT_PADDING_Y })
        gaugeLabel.offsetX(paddedWidth / 2)
        gaugeLabel.offsetY(paddedHeight / 2)
        gaugeLabel.position({ x, y })
        gaugeLabel.rotation(angle)
      }

      const flowLabel = cableFlowMap.get(cableId)
      if (flowLabel) {
        const textNode = flowLabel.findOne<Konva.Text>('.cable-flow-text')
        const backgroundNode = flowLabel.findOne<Konva.Rect>('.cable-flow-bg')
        if (!textNode || !backgroundNode) return
        const { x, y, angle } = getPolylineMidpointWithAngle(points)
        const textWidth = textNode.getTextWidth()
        const textHeight = textNode.height() || textNode.fontSize()
        const paddedWidth = textWidth + CABLE_FLOW_PADDING_X * 2
        const paddedHeight = textHeight + CABLE_FLOW_PADDING_Y * 2
        backgroundNode.size({ width: paddedWidth, height: paddedHeight })
        textNode.position({ x: CABLE_FLOW_PADDING_X, y: CABLE_FLOW_PADDING_Y })
        flowLabel.offsetX(paddedWidth / 2)
        flowLabel.offsetY(paddedHeight / 2)
        const offsetX = angle === 90 ? CABLE_FLOW_OFFSET : 0
        const offsetY = angle === 90 ? 0 : -CABLE_FLOW_OFFSET
        flowLabel.position({ x: x + offsetX, y: y + offsetY })
        flowLabel.rotation(0)
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

  const applyFlowIndicators = () => {
    const flow = schemaStore.flow
    lineMap.forEach((line, cableId) => {
      const cable = schemaStore.schema.cables.find((item) => item.id === cableId)
      if (!cable) return
      const edgeFlow = flow?.edges?.[cableId]
      const currentA = edgeFlow?.currentA ?? 0
      const magnitude = Math.abs(currentA)
      const arrow = currentA >= 0 ? '→' : '←'
      const label = cableFlowMap.get(cableId)

      if (label) {
        const textNode = label.findOne<Konva.Text>('.cable-flow-text')
        const backgroundNode = label.findOne<Konva.Rect>('.cable-flow-bg')
        if (textNode) {
          textNode.text(magnitude > 0.05 ? `${arrow} ${magnitude.toFixed(1)}A` : '0.0A')
        }
        if (textNode && backgroundNode) {
          const textWidth = textNode.getTextWidth()
          const textHeight = textNode.height() || textNode.fontSize()
          const paddedWidth = textWidth + CABLE_FLOW_PADDING_X * 2
          const paddedHeight = textHeight + CABLE_FLOW_PADDING_Y * 2
          backgroundNode.size({ width: paddedWidth, height: paddedHeight })
          textNode.position({ x: CABLE_FLOW_PADDING_X, y: CABLE_FLOW_PADDING_Y })
          label.offsetX(paddedWidth / 2)
          label.offsetY(paddedHeight / 2)
        }
        const showLabel = magnitude > 0.01 || schemaStore.schema.selection.cableId === cableId
        label.visible(showLabel)
      }

      const utilization = edgeFlow?.utilization ?? 0
      const limited = edgeFlow?.limitedBy && edgeFlow.limitedBy.length > 0
      const isSelected = schemaStore.schema.selection.cableId === cableId
      let stroke = '#e64141ff'
      if (limited || utilization >= 1) {
        stroke = '#d96b3a'
      } else if (utilization >= 0.8) {
        stroke = '#f2b46d'
      } else if (magnitude < 0.01) {
        stroke = '#c9b8a6'
      }
      if (isSelected) {
        stroke = '#2d2a25'
      }

      const disabled =
        !schemaStore.isComponentEnabled(cable.from.nodeId) ||
        !schemaStore.isComponentEnabled(cable.to.nodeId)

      line.stroke(stroke)
      line.fill(stroke)
      line.opacity(disabled ? 0.35 : 1)
      label?.opacity(disabled ? 0.35 : 1)
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
    applyFlowIndicators,
  }
}
