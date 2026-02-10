import Konva from 'konva'
import type { Ref } from 'vue'
import type { useSchemaStore } from '~/stores/schema'
import type { ComponentInstance } from '~/types/schema'
import { NODE_HEIGHT, NODE_SCALE, NODE_WIDTH, type CanvasMode } from './constants'

type CanvasNodesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
  getMode: () => CanvasMode
  pendingSourceId: Ref<string | null>
  onRequestSyncCables: () => void
}

const getAssetPath = (path: string, baseURL: string) => {
  return baseURL.endsWith('/') ? `${baseURL}${path.slice(1)}` : `${baseURL}${path}`
}

const nodeImageSize = {
  width: Math.round(64 * NODE_SCALE),
  height: Math.round(64 * NODE_SCALE),
}
const nodeImageOffset = {
  x: Math.round((NODE_WIDTH - nodeImageSize.width) / 2),
  y: Math.round(6 * NODE_SCALE),
}
const nodeTitleY = nodeImageOffset.y + nodeImageSize.height + 2
const nodeTitleFontSize = Math.round(13 * NODE_SCALE)
const nodeHaloRadius = nodeImageSize.width / 2 + Math.round(10 * NODE_SCALE)

const nodeImageCache = new Map<string, HTMLImageElement>()

const iconUrlForComponent = (component: ComponentInstance, baseURL: string) => {
  const getPath = (path: string) => getAssetPath(path, baseURL)
  
  if (component.typeId === 'dc-dc-charger') return getPath('/icons/dc-dc.svg')
  if (component.typeId === 'alternator') return getPath('/icons/alternator.svg')
  if (component.typeId === 'battery') return getPath('/icons/battery.svg')
  if (component.typeId === 'dc-bus') return getPath('/icons/positive-bus-bar.svg')
  if (component.typeId === 'shore-inlet') return getPath('/icons/shore-inlet.svg')
  if (component.typeId === 'solar-panel') return getPath('/icons/solar-panel.svg')
  if (component.typeId === 'fuse') return getPath('/icons/fuse.svg')
  if (component.typeId === 'ac-dc-charger') return getPath('/icons/ac-dc-charger.svg')
  if (component.typeId === 'led-light') return getPath('/icons/led-light.svg')
  if (component.typeId === 'light-bar') return getPath('/icons/led-bar.svg')

  return getPath('/icons/mppt.svg')
}

const ensureNodeImage = (layer: Konva.Layer, url: string) => {
  const cached = nodeImageCache.get(url)
  if (cached || typeof window === 'undefined') return cached ?? null
  const image = new window.Image()
  image.src = url
  image.onload = () => {
    layer.batchDraw()
  }
  nodeImageCache.set(url, image)
  return image
}

export const useCanvasNodes = ({
  layer,
  schemaStore,
  getMode,
  pendingSourceId,
  onRequestSyncCables,
}: CanvasNodesOptions) => {
  const config = useRuntimeConfig()
  const baseURL = config.app.baseURL
  const nodeMap = new Map<string, Konva.Group>()

  const getNodeCenter = (nodeId: string) => {
    const node = nodeMap.get(nodeId)
    if (!node) return null
    return {
      x: node.x() + NODE_WIDTH / 2,
      y: node.y() + NODE_HEIGHT / 2,
    }
  }

  const ensureNode = (component: ComponentInstance) => {
    const componentId = component.id
    const existing = nodeMap.get(componentId)
    if (existing) return existing

    const group = new Konva.Group({
      draggable: true,
      id: componentId,
    })

    const rect = new Konva.Rect({
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      fill: '#ffffff',
      opacity: 0.01,
      stroke: 'transparent',
      cornerRadius: 12,
      name: 'node-rect',
    })

    const halo = new Konva.Circle({
      x: NODE_WIDTH / 2,
      y: nodeImageOffset.y + nodeImageSize.height / 2,
      radius: nodeHaloRadius,
      stroke: '#d96b3a',
      strokeWidth: 2,
      opacity: 0,
      visible: false,
      listening: false,
      name: 'node-halo',
    })

    const title = new Konva.Text({
      x: 0,
      y: nodeTitleY,
      width: NODE_WIDTH,
      align: 'center',
      text: componentId,
      fontSize: nodeTitleFontSize,
      fontFamily: 'Space Grotesk, sans-serif',
      fill: '#2d2a25',
      name: 'node-title',
    })

    const badge = new Konva.Circle({
      x: NODE_WIDTH - 14,
      y: 14,
      radius: 6,
      fill: '#f2b46d',
      stroke: '#ffffff',
      strokeWidth: 1,
      visible: false,
      name: 'issue-badge',
    })

    const iconUrl = iconUrlForComponent(component, baseURL)
    const imageElement = ensureNodeImage(layer, iconUrl)
    const image = new Konva.Image({
      x: nodeImageOffset.x,
      y: nodeImageOffset.y,
      width: nodeImageSize.width,
      height: nodeImageSize.height,
      image: imageElement ?? undefined,
      opacity: 0.9,
      listening: false,
      name: 'node-image',
    })

    group.add(rect)
    group.add(halo)
    group.add(image)
    group.add(title)
    group.add(badge)
    group.setAttr('iconUrl', iconUrl)

    const connectionExists = (sourceId: string, targetId: string) =>
      schemaStore.schema.cables.some(
        (cable) =>
          (cable.sourceId === sourceId && cable.targetId === targetId) ||
          (cable.sourceId === targetId && cable.targetId === sourceId),
      )

    const createCable = (sourceId: string, targetId: string) => {
      if (connectionExists(sourceId, targetId)) return null

      const newCableId = `cable-${Date.now()}`
      schemaStore.addCable({
        id: newCableId,
        name: `Cable ${sourceId} → ${targetId}`,
        sourceId,
        targetId,
        props: { lengthM: 2, gaugeAwg: 8 },
        derived: {
          ampacityA: 0,
          expectedCurrentA: 0,
          expectedPowerW: 0,
          circuitVoltageV: 0,
          resistanceOhmPerM: 0,
          loopResistanceOhm: 0,
          voltageDropV: 0,
        },
      })
      return newCableId
    }

    const handleNodeClick = (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (event.evt?.shiftKey) {
        const selectedId = schemaStore.schema.selection.componentId
        if (selectedId && selectedId !== componentId) {
          const newCableId = createCable(selectedId, componentId)
          if (newCableId) {
            schemaStore.setSelection({ cableId: newCableId })
          }
        }
        return
      }

      if (getMode() === 'connect') {
        if (!pendingSourceId.value) {
          pendingSourceId.value = componentId
          schemaStore.setSelection({ componentId })
          return
        }

        if (pendingSourceId.value === componentId) {
          return
        }

        const newCableId = createCable(pendingSourceId.value, componentId)
        if (newCableId) {
          schemaStore.setSelection({ cableId: newCableId })
        }
        pendingSourceId.value = null
        return
      }

      schemaStore.setSelection({ componentId })
    }

    group.on('click tap', (event) => {
      event.cancelBubble = true
      handleNodeClick(event)
    })

    group.on('dragmove', () => {
      onRequestSyncCables()
      layer.batchDraw()
    })

    group.on('dragend', () => {
      schemaStore.updateComponent(componentId, {
        position: { x: group.x(), y: group.y() },
      })
    })

    nodeMap.set(componentId, group)
    layer.add(group)
    return group
  }

  const syncNodes = (components: ComponentInstance[]) => {
    components.forEach((component) => {
      const node = ensureNode(component)
      node.position({ x: component.position.x, y: component.position.y })
      const title = node.findOne<Konva.Text>('.node-title')
      if (title) title.text(component.name || component.id)
      const nextIconUrl = iconUrlForComponent(component, baseURL)
      const currentIconUrl = node.getAttr('iconUrl')
      if (currentIconUrl !== nextIconUrl) {
        const image = node.findOne<Konva.Image>('.node-image')
        if (image) {
          image.image(ensureNodeImage(layer, nextIconUrl) ?? undefined)
        }
        node.setAttr('iconUrl', nextIconUrl)
      }
      node.zIndex(3)
    })
  }

  const pruneNodes = (currentComponentIds: Set<string>) => {
    nodeMap.forEach((node, nodeId) => {
      if (!currentComponentIds.has(nodeId)) {
        node.destroy()
        nodeMap.delete(nodeId)
      }
    })
  }

  const applySelection = (selectedComponentId: string | undefined, pendingId: string | null) => {
    nodeMap.forEach((node, nodeId) => {
      const halo = node.findOne<Konva.Circle>('.node-halo')
      if (!halo) return
      const isSelected = nodeId === selectedComponentId
      const isPending = nodeId === pendingId
      const active = isSelected || isPending
      halo.visible(active)
      halo.stroke(isPending ? '#4c7d6b' : '#d96b3a')
      halo.opacity(active ? 0.22 : 0)
    })
  }

  const applyIssueBadges = (componentIssues: Map<string, 'warning' | 'error'>) => {
    nodeMap.forEach((node, nodeId) => {
      const badge = node.findOne<Konva.Circle>('.issue-badge')
      if (!badge) return
      const level = componentIssues.get(nodeId)
      if (!level) {
        badge.visible(false)
        return
      }
      badge.visible(true)
      badge.fill(level === 'error' ? '#e07a5f' : '#f2b46d')
    })
  }

  return {
    nodeMap,
    getNodeCenter,
    syncNodes,
    pruneNodes,
    applySelection,
    applyIssueBadges,
    ensureAssets: () => {
      ensureNodeImage(layer, getAssetPath('/icons/mppt.svg', baseURL))
      ensureNodeImage(layer, getAssetPath('/icons/dc-dc.svg', baseURL))
    },
  }
}
