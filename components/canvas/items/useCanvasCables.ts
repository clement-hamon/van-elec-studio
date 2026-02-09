import Konva from 'konva'
import type { useSchemaStore } from '~/stores/schema'

type CanvasCablesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
}

export const useCanvasCables = ({ layer, schemaStore }: CanvasCablesOptions) => {
  const lineMap = new Map<string, Konva.Arrow>()
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

    const line = new Konva.Arrow({
      points: [0, 0, 0, 0],
      stroke: '#2d2a25',
      fill: '#2d2a25',
      strokeWidth: 2,
      pointerLength: 10,
      pointerWidth: 8,
      lineCap: 'round',
      lineJoin: 'round',
      hitStrokeWidth: 12,
      id: cableId,
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
      line.points([sourceCenter.x, sourceCenter.y, targetCenter.x, targetCenter.y])

      const badge = cableBadgeMap.get(cableId)
      if (badge) {
        badge.position({
          x: (sourceCenter.x + targetCenter.x) / 2,
          y: (sourceCenter.y + targetCenter.y) / 2,
        })
      }
    })
  }

  const applySelection = (selectedCableId: string | undefined) => {
    lineMap.forEach((line, cableId) => {
      const isSelected = cableId === selectedCableId
      line.stroke(isSelected ? '#d96b3a' : '#2d2a25')
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
