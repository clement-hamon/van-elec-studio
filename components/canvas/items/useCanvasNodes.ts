import Konva from 'konva'
import type { Ref } from 'vue'
import type { useSchemaStore } from '~/stores/schema'
import type { ComponentInstance } from '~/types/schema'
import { estimateAmpacityForAwg } from '~/services/cable'
import { NODE_HEIGHT, NODE_SCALE, NODE_WIDTH, type CanvasMode } from './constants'
import { useCablePortResolver, type CableConductorChoice } from './useCablePortResolver'

type CanvasNodesOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
  getMode: () => CanvasMode
  pendingSourceId: Ref<string | null>
  onRequestSyncCables: () => void
  onRequestCableConductor?: (payload: {
    source: ComponentInstance
    target: ComponentInstance
    availableConductors: CableConductorChoice[]
  }) => Promise<CableConductorChoice | null>
}

const getAssetPath = (path: string, baseURL: string) => {
  return baseURL.endsWith('/') ? `${baseURL}${path.slice(1)}` : `${baseURL}${path}`
}

const baseNodeImageSize = {
  width: Math.round(64 * NODE_SCALE),
  height: Math.round(64 * NODE_SCALE),
}
const baseNodeImageOffsetY = Math.round(6 * NODE_SCALE)
const nodeTitleFontSize = Math.round(13 * NODE_SCALE)
const nodeFlowOffsetY = Math.round(16 * NODE_SCALE)
const nodeFlowFontSize = Math.round(11 * NODE_SCALE)

const nodeImageCache = new Map<string, HTMLImageElement>()

const getNodeMetrics = (component: ComponentInstance) => {
  const imageScaleRatio = component.imageScaleRatio ?? 1
  const imageWidth = Math.round(baseNodeImageSize.width * imageScaleRatio)
  const imageHeight = Math.round(baseNodeImageSize.height * imageScaleRatio)
  const imageOffset = {
    x: Math.round((NODE_WIDTH - imageWidth) / 2),
    y: baseNodeImageOffsetY,
  }
  const titleY = imageOffset.y + imageHeight + 2
  const flowY = titleY + nodeFlowOffsetY
  const haloRadius = imageWidth / 2 + Math.round(10 * NODE_SCALE)

  return {
    imageWidth,
    imageHeight,
    imageOffset,
    titleY,
    flowY,
    haloRadius,
  }
}

const iconUrlForComponent = (component: ComponentInstance, baseURL: string) => {
  const getPath = (path: string) => getAssetPath(path, baseURL)
  
  if (component.typeId === 'dc-dc-charger') return getPath('/icons/dc-dc.svg')
  if (component.typeId === 'alternator') return getPath('/icons/alternator.svg')
  if (component.typeId === 'battery') return getPath('/icons/battery.svg')
  if (component.typeId === 'dc-bus') return getPath('/icons/positive-bus-bar.svg')
  if (component.typeId === 'dc-neg-bus') return getPath('/icons/negative-bus-bar.svg')
  if (component.typeId === 'shore-inlet') return getPath('/icons/shore-inlet.svg')
  if (component.typeId === 'solar-panel') return getPath('/icons/solar-panel.svg')
  if (component.typeId === 'fuse') return getPath('/icons/fuse.svg')
  if (component.typeId === 'switch') return getPath('/icons/switch.svg')
  if (component.typeId === 'ac-dc-charger') return getPath('/icons/ac-dc-charger.svg')
  if (component.typeId === 'led-light') return getPath('/icons/led-light.svg')
  if (component.typeId === 'light-bar') return getPath('/icons/led-bar.svg')
  if (component.typeId === 'fridge-12v') return getPath('/icons/fridge.svg')
  if (component.typeId === 'tv') return getPath('/icons/tv.svg')

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
  onRequestCableConductor,
}: CanvasNodesOptions) => {
  const config = useRuntimeConfig()
  const baseURL = config.app.baseURL
  const nodeMap = new Map<string, Konva.Group>()
  const { resolvePreferredEndpoints, resolveAvailableConductors } = useCablePortResolver()

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

    const metrics = getNodeMetrics(component)

    const componentGroup = new Konva.Group({
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

    const error_halo = new Konva.Circle({
      x: NODE_WIDTH / 2,
      y: metrics.imageOffset.y + metrics.imageHeight / 2,
      radius: metrics.haloRadius,
      fill: '#d96b3a',
      opacity: 0.22,
      visible: false,
      listening: false,
      name: 'error_halo',
    })

    const selection_halo = new Konva.Circle({
      x: NODE_WIDTH / 2,
      y: metrics.imageOffset.y + metrics.imageHeight / 2,
      radius: metrics.haloRadius,
      stroke: '#3a84d9',
      strokeWidth: 2,
      opacity: 0,
      visible: false,
      listening: false,
      name: 'selection_halo',
    })

    const title = new Konva.Text({
      x: 0,
      y: metrics.titleY,
      width: NODE_WIDTH,
      align: 'center',
      text: componentId,
      fontSize: nodeTitleFontSize,
      fontFamily: 'Space Grotesk, sans-serif',
      fill: '#2d2a25',
      name: 'node-title',
    })

    const flowText = new Konva.Text({
      x: 0,
      y: metrics.flowY,
      width: NODE_WIDTH,
      align: 'center',
      text: '',
      fontSize: nodeFlowFontSize,
      fontFamily: 'Space Grotesk, sans-serif',
      fill: '#6a4b3b',
      visible: false,
      name: 'node-flow',
      listening: false,
    })

    const iconUrl = iconUrlForComponent(component, baseURL)

    const imageElement = ensureNodeImage(layer, iconUrl)
    const image = new Konva.Image({
      x: metrics.imageOffset.x,
      y: metrics.imageOffset.y,
      width: metrics.imageWidth,
      height: metrics.imageHeight,
      image: imageElement ?? undefined,
      listening: false,
      name: 'node-image',
    })

    componentGroup.add(rect)
    componentGroup.add(error_halo)
    componentGroup.add(selection_halo)
    componentGroup.add(image)
    componentGroup.add(title)
    componentGroup.add(flowText)
    componentGroup.setAttr('iconUrl', iconUrl)

    const createCable = async (firstId: string, secondId: string) => {
      const first = schemaStore.schema.components.find((component) => component.id === firstId)
      const second = schemaStore.schema.components.find((component) => component.id === secondId)
      if (!first || !second) return null

      const availableConductors = resolveAvailableConductors(first, second, schemaStore.schema.cables)
      let selectedConductor: CableConductorChoice | undefined

      if (availableConductors.length > 0) {
        selectedConductor = onRequestCableConductor
          ? await onRequestCableConductor({ source: first, target: second, availableConductors }) ?? undefined
          : availableConductors[0]
        if (!selectedConductor) return null
      }

      const endpoints = resolvePreferredEndpoints(first, second, schemaStore.schema.cables, selectedConductor)
      if (!endpoints) return null

      const newCableId = `cable-${Date.now()}`
      const gaugeAwg = 8
      schemaStore.addCable({
        id: newCableId,
        name: `Cable ${endpoints.from.nodeId} → ${endpoints.to.nodeId}`,
        from: endpoints.from,
        to: endpoints.to,
        wire: { lengthM: 2, gaugeAwg, maxA: estimateAmpacityForAwg(gaugeAwg) },
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

    const handleNodeClick = async (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (event.evt?.shiftKey) {
        const selectedId = schemaStore.schema.selection.componentId
        if (selectedId && selectedId !== componentId) {
          const newCableId = await createCable(selectedId, componentId)
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

        const newCableId = await createCable(pendingSourceId.value, componentId)
        if (newCableId) {
          schemaStore.setSelection({ cableId: newCableId })
        }
        pendingSourceId.value = null
        return
      }

      schemaStore.setSelection({ componentId })
    }

    componentGroup.on('click tap', (event) => {
      event.cancelBubble = true
      void handleNodeClick(event)
    })

    componentGroup.on('dragmove', () => {
      onRequestSyncCables()
      layer.batchDraw()
    })

    componentGroup.on('dragend', () => {
      schemaStore.updateComponent(componentId, {
        position: { x: componentGroup.x(), y: componentGroup.y() },
      })
    })

    nodeMap.set(componentId, componentGroup)
    layer.add(componentGroup)
    return componentGroup
  }

  const syncNodes = (components: ComponentInstance[]) => {
    components.forEach((component) => {
      const node = ensureNode(component)
      const metrics = getNodeMetrics(component)
      node.position({ x: component.position.x, y: component.position.y })
      const title = node.findOne<Konva.Text>('.node-title')
      if (title) {
        title.text(component.name || component.id)
        title.y(metrics.titleY)
      }
      const flowText = node.findOne<Konva.Text>('.node-flow')
      if (flowText) flowText.y(metrics.flowY)
      const errorHalo = node.findOne<Konva.Circle>('.error_halo')
      if (errorHalo) {
        errorHalo.y(metrics.imageOffset.y + metrics.imageHeight / 2)
        errorHalo.radius(metrics.haloRadius)
      }
      const selectionHalo = node.findOne<Konva.Circle>('.selection_halo')
      if (selectionHalo) {
        selectionHalo.y(metrics.imageOffset.y + metrics.imageHeight / 2)
        selectionHalo.radius(metrics.haloRadius)
      }
      node.opacity(schemaStore.isComponentEnabled(component.id) ? 1 : 0.45)
      const image = node.findOne<Konva.Image>('.node-image')
      if (image) {
        image.position(metrics.imageOffset)
        image.size({ width: metrics.imageWidth, height: metrics.imageHeight })
      }
      const nextIconUrl = iconUrlForComponent(component, baseURL)
      const currentIconUrl = node.getAttr('iconUrl')
      if (currentIconUrl !== nextIconUrl) {
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
      const halo = node.findOne<Konva.Circle>('.selection_halo')
      if (!halo) return
      const isSelected = nodeId === selectedComponentId
      const isPending = nodeId === pendingId
      const active = isSelected || isPending
      halo.visible(active)
      // halo.stroke(isPending ? '#4c7d6b' : '#d96b3a')
      halo.opacity(active ? 0.22 : 0)
    })
  }

  const applyIssueBadges = (componentIssues: Map<string, 'warning' | 'error'>) => {
    nodeMap.forEach((node, nodeId) => {
      const error_halo = node.findOne<Konva.Circle>('.error_halo')
      if (!error_halo) return
      const level = componentIssues.get(nodeId)
      if (!level) {
        error_halo.visible(false)
        return
      }
      error_halo.visible(true)
    })
  }

  const applyFlowIndicators = () => {
    const flow = schemaStore.flow
    nodeMap.forEach((node, nodeId) => {
      const flowText = node.findOne<Konva.Text>('.node-flow')
      if (!flowText) return
      const enabled = schemaStore.isComponentEnabled(nodeId)
      node.opacity(enabled ? 1 : 0.45)
      if (!enabled) {
        flowText.text('OFF')
        flowText.fill('#9b8f84')
        flowText.visible(true)
        return
      }

      const nodeFlow = flow?.nodes?.[nodeId]
      let text = ''
      let color = '#6a4b3b'

      if (nodeFlow?.state) {
        const current = nodeFlow.netA !== undefined ? `${Math.abs(nodeFlow.netA).toFixed(1)}A` : ''
        text = `${nodeFlow.state}${current ? ` ${current}` : ''}`
        color = nodeFlow.state === 'charging' ? '#4c7d6b' : '#d96b3a'
      } else if (nodeFlow?.supplyW && nodeFlow.supplyW > 0) {
        text = `supply ${nodeFlow.supplyW.toFixed(0)}W`
        color = '#3a84d9'
      } else if (nodeFlow?.demandW && nodeFlow.demandW > 0) {
        text = `load ${nodeFlow.demandW.toFixed(0)}W`
        color = '#6a4b3b'
      }

      flowText.text(text)
      flowText.fill(color)
      flowText.visible(text.length > 0)
    })
  }

  return {
    nodeMap,
    getNodeCenter,
    syncNodes,
    pruneNodes,
    applySelection,
    applyIssueBadges,
    applyFlowIndicators,
    ensureAssets: () => {
      ensureNodeImage(layer, getAssetPath('/icons/mppt.svg', baseURL))
      ensureNodeImage(layer, getAssetPath('/icons/dc-dc.svg', baseURL))
    },
  }
}
