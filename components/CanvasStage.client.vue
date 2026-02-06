<template>
  <div ref="container" class="canvas-stage" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { useSchemaStore } from '~/stores/schema'

const container = ref<HTMLDivElement | null>(null)
const schemaStore = useSchemaStore()

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let background: Konva.Rect | null = null
let resizeObserver: ResizeObserver | null = null

const nodeMap = new Map<string, Konva.Group>()
const lineMap = new Map<string, Konva.Line>()

const nodeWidth = 160
const nodeHeight = 90

const getNodeCenter = (nodeId: string) => {
  const node = nodeMap.get(nodeId)
  if (!node) return null
  return {
    x: node.x() + nodeWidth / 2,
    y: node.y() + nodeHeight / 2,
  }
}

const syncCableLines = () => {
  lineMap.forEach((line, cableId) => {
    const cable = schemaStore.schema.cables.find((item) => item.id === cableId)
    if (!cable) return
    const sourceCenter = getNodeCenter(cable.sourceId)
    const targetCenter = getNodeCenter(cable.targetId)
    if (!sourceCenter || !targetCenter) return
    line.points([sourceCenter.x, sourceCenter.y, targetCenter.x, targetCenter.y])
  })
}

const applySelection = () => {
  const selectedComponentId = schemaStore.schema.selection.componentId
  const selectedCableId = schemaStore.schema.selection.cableId

  nodeMap.forEach((node, nodeId) => {
    const rect = node.findOne<Konva.Rect>('.node-rect')
    if (!rect) return
    const isSelected = nodeId === selectedComponentId
    rect.stroke(isSelected ? '#d96b3a' : '#2d2a25')
    rect.shadowOpacity(isSelected ? 0.3 : 0.15)
  })

  lineMap.forEach((line, cableId) => {
    const isSelected = cableId === selectedCableId
    line.stroke(isSelected ? '#d96b3a' : '#2d2a25')
    line.strokeWidth(isSelected ? 3.5 : 2)
  })
}

const ensureNode = (componentId: string) => {
  const existing = nodeMap.get(componentId)
  if (existing) return existing

  const group = new Konva.Group({
    draggable: true,
    id: componentId,
  })

  const rect = new Konva.Rect({
    width: nodeWidth,
    height: nodeHeight,
    fill: '#f6f1e6',
    stroke: '#2d2a25',
    strokeWidth: 1.5,
    cornerRadius: 12,
    shadowColor: '#2d2a25',
    shadowBlur: 12,
    shadowOpacity: 0.15,
    shadowOffset: { x: 0, y: 6 },
    name: 'node-rect',
  })

  const title = new Konva.Text({
    x: 16,
    y: 20,
    text: componentId,
    fontSize: 15,
    fontFamily: 'Space Grotesk, sans-serif',
    fill: '#2d2a25',
    name: 'node-title',
  })

  group.add(rect)
  group.add(title)

  group.on('click tap', (event) => {
    event.cancelBubble = true
    schemaStore.setSelection({ componentId })
    applySelection()
    layer?.batchDraw()
  })

  group.on('dragmove', () => {
    syncCableLines()
    layer?.batchDraw()
  })

  group.on('dragend', () => {
    schemaStore.updateComponent(componentId, {
      position: { x: group.x(), y: group.y() },
    })
  })

  nodeMap.set(componentId, group)
  layer?.add(group)
  return group
}

const ensureCable = (cableId: string) => {
  const existing = lineMap.get(cableId)
  if (existing) return existing

  const line = new Konva.Line({
    points: [0, 0, 0, 0],
    stroke: '#2d2a25',
    strokeWidth: 2,
    lineCap: 'round',
    lineJoin: 'round',
    hitStrokeWidth: 12,
    id: cableId,
  })

  line.on('click tap', (event) => {
    event.cancelBubble = true
    schemaStore.setSelection({ cableId })
    applySelection()
    layer?.batchDraw()
  })

  lineMap.set(cableId, line)
  layer?.add(line)
  line.zIndex(1)
  return line
}

const syncScene = () => {
  if (!layer) return

  const currentComponentIds = new Set(schemaStore.schema.components.map((component) => component.id))
  const currentCableIds = new Set(schemaStore.schema.cables.map((cable) => cable.id))

  schemaStore.schema.components.forEach((component) => {
    const node = ensureNode(component.id)
    node.position({ x: component.position.x, y: component.position.y })
    const title = node.findOne<Konva.Text>('.node-title')
    if (title) title.text(component.name || component.id)
    node.zIndex(2)
  })

  schemaStore.schema.cables.forEach((cable) => {
    const line = ensureCable(cable.id)
    line.zIndex(1)
  })

  nodeMap.forEach((node, nodeId) => {
    if (!currentComponentIds.has(nodeId)) {
      node.destroy()
      nodeMap.delete(nodeId)
    }
  })

  lineMap.forEach((line, cableId) => {
    if (!currentCableIds.has(cableId)) {
      line.destroy()
      lineMap.delete(cableId)
    }
  })

  syncCableLines()
  applySelection()
  layer.batchDraw()
}

const initStage = () => {
  if (!container.value) return

  stage = new Konva.Stage({
    container: container.value,
    width: container.value.clientWidth,
    height: container.value.clientHeight,
  })

  layer = new Konva.Layer()
  stage.add(layer)

  background = new Konva.Rect({
    x: 0,
    y: 0,
    width: stage.width(),
    height: stage.height(),
    fill: '#111111',
    opacity: 0.02,
  })
  background.on('click tap', () => {
    schemaStore.setSelection({})
    applySelection()
    layer?.batchDraw()
  })
  layer.add(background)
  background.zIndex(0)

  resizeObserver = new ResizeObserver(() => {
    if (!stage || !container.value || !background) return
    stage.size({
      width: container.value.clientWidth,
      height: container.value.clientHeight,
    })
    background.width(stage.width())
    background.height(stage.height())
    syncCableLines()
    stage.batchDraw()
  })

  resizeObserver.observe(container.value)

  syncScene()
}

watch(
  () => schemaStore.schema,
  () => syncScene(),
  { deep: true },
)

onMounted(() => initStage())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stage?.destroy()
})
</script>
