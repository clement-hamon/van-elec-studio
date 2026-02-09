<template>
  <div class="canvas-stage-shell">
    <div
      ref="container"
      class="canvas-stage"
      :class="{ 'canvas-stage--drag': isDragOver, 'canvas-stage--panning': isPanning }"
      @dragover.prevent
      @dragenter.prevent="onDragEnter"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    />
    <div class="canvas-zoom" aria-label="Canvas zoom controls">
      <div class="canvas-zoom__header">
        <span class="canvas-zoom__label">Zoom</span>
        <span class="canvas-zoom__value">{{ zoomPercent }}%</span>
      </div>
      <div class="canvas-zoom__controls">
        <button
          class="canvas-zoom__btn"
          type="button"
          :disabled="!canZoomOut"
          aria-label="Zoom out"
          @click="zoomOut"
        >
          -
        </button>
        <input
          class="canvas-zoom__range"
          type="range"
          :min="minScale"
          :max="maxScale"
          :step="sliderStep"
          :value="zoomLevel"
          aria-label="Zoom level"
          @input="onZoomInput"
        />
        <button
          class="canvas-zoom__btn"
          type="button"
          :disabled="!canZoomIn"
          aria-label="Zoom in"
          @click="zoomIn"
        >
          +
        </button>
      </div>
      <button class="canvas-zoom__reset" type="button" @click="resetView">Reset view</button>
      <p class="canvas-zoom__hint">Drag the canvas to move around.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { useSchemaStore } from '~/stores/schema'

type Mode = 'select' | 'connect'

const props = defineProps<{
  mode: Mode
}>()

const container = ref<HTMLDivElement | null>(null)
const schemaStore = useSchemaStore()
const pendingSourceId = ref<string | null>(null)
const isDragOver = ref(false)
const isPanning = ref(false)
const zoomLevel = ref(1)

const minScale = 0.5
const maxScale = 2.5
const zoomStep = 0.1
const sliderStep = 0.05
const zoomPercent = computed(() => Math.round(zoomLevel.value * 100))
const canZoomIn = computed(() => zoomLevel.value < maxScale - 0.001)
const canZoomOut = computed(() => zoomLevel.value > minScale + 0.001)

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let background: Konva.Rect | null = null
let resizeObserver: ResizeObserver | null = null
let keydownHandler: ((event: KeyboardEvent) => void) | null = null

const nodeMap = new Map<string, Konva.Group>()
const lineMap = new Map<string, Konva.Line>()
const cableBadgeMap = new Map<string, Konva.Circle>()

const nodeWidth = 160
const nodeHeight = 90
const nodeIconOffset = { x: 16, y: 48 }
const iconStroke = '#2d2a25'
const iconFill = '#f6f1e6'
const iconAccent = '#4c7d6b'

const issueColor = (level: 'warning' | 'error') => (level === 'error' ? '#e07a5f' : '#f2b46d')

const buildNodeIcon = (typeId: string) => {
  const group = new Konva.Group({
    x: nodeIconOffset.x,
    y: nodeIconOffset.y,
    name: 'node-icon',
    listening: false,
  })

  const addLine = (points: number[]) => {
    group.add(
      new Konva.Line({
        points,
        stroke: iconStroke,
        strokeWidth: 1.4,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    )
  }

  if (typeId === 'battery') {
    group.add(
      new Konva.Rect({
        x: 0,
        y: 5,
        width: 28,
        height: 14,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    group.add(
      new Konva.Rect({
        x: 2.5,
        y: 7,
        width: 16,
        height: 10,
        fill: iconAccent,
        cornerRadius: 1,
      }),
    )
    group.add(
      new Konva.Rect({
        x: 28,
        y: 9,
        width: 4,
        height: 6,
        fill: iconStroke,
        cornerRadius: 1,
      }),
    )
    return group
  }

  if (typeId === 'fuse') {
    group.add(
      new Konva.Rect({
        x: 2,
        y: 6,
        width: 30,
        height: 12,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    addLine([5, 12, 9, 8, 13, 16, 17, 8, 21, 16, 25, 8, 29, 12])
    return group
  }

  if (typeId === 'inverter') {
    group.add(
      new Konva.Rect({
        x: 2,
        y: 4,
        width: 30,
        height: 16,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 3,
      }),
    )
    addLine([6, 12, 9, 8, 12, 12, 15, 16, 18, 12, 21, 8, 24, 12, 27, 16])
    return group
  }

  if (typeId === 'led-light') {
    group.add(
      new Konva.Circle({
        x: 12,
        y: 12,
        radius: 6,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
      }),
    )
    addLine([12, 2, 12, 5])
    addLine([12, 19, 12, 22])
    addLine([4, 12, 7, 12])
    addLine([17, 12, 20, 12])
    addLine([6, 6, 8, 8])
    addLine([16, 6, 14, 8])
    return group
  }

  if (typeId === 'light-bar') {
    group.add(
      new Konva.Rect({
        x: 2,
        y: 9,
        width: 30,
        height: 6,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    addLine([6, 17, 6, 20])
    addLine([14, 17, 14, 20])
    addLine([22, 17, 22, 20])
    addLine([30, 17, 30, 20])
    return group
  }

  if (typeId === 'custom-load') {
    addLine([4, 12, 8, 8, 12, 16, 16, 8, 20, 16, 24, 8, 28, 12])
    addLine([2, 12, 4, 12])
    addLine([28, 12, 32, 12])
    return group
  }

  if (typeId === 'dc-bus') {
    group.add(
      new Konva.Rect({
        x: 4,
        y: 10,
        width: 28,
        height: 4,
        fill: iconStroke,
        cornerRadius: 2,
      }),
    )
    addLine([8, 14, 8, 20])
    addLine([16, 14, 16, 20])
    addLine([24, 14, 24, 20])
    addLine([12, 8, 12, 10])
    addLine([20, 8, 20, 10])
    return group
  }

  if (typeId === 'solar-panel') {
    group.add(
      new Konva.Rect({
        x: 4,
        y: 8,
        width: 26,
        height: 12,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    addLine([12, 8, 12, 20])
    addLine([20, 8, 20, 20])
    addLine([4, 14, 30, 14])
    group.add(
      new Konva.Circle({
        x: 8,
        y: 4,
        radius: 3,
        fill: iconAccent,
        stroke: iconStroke,
        strokeWidth: 1,
      }),
    )
    return group
  }

  if (typeId === 'charge-controller') {
    group.add(
      new Konva.Rect({
        x: 4,
        y: 6,
        width: 26,
        height: 14,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 3,
      }),
    )
    group.add(
      new Konva.Circle({
        x: 12,
        y: 13,
        radius: 3,
        fill: iconAccent,
        stroke: iconStroke,
        strokeWidth: 1,
      }),
    )
    addLine([18, 13, 26, 13])
    addLine([24, 11, 26, 13, 24, 15])
    return group
  }

  if (typeId === 'alternator') {
    group.add(
      new Konva.Circle({
        x: 14,
        y: 12,
        radius: 9,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
      }),
    )
    addLine([8, 12, 10, 8, 12, 12, 14, 16, 16, 12, 18, 8, 20, 12])
    return group
  }

  if (typeId === 'dc-dc-charger') {
    group.add(
      new Konva.Rect({
        x: 2,
        y: 8,
        width: 10,
        height: 8,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    group.add(
      new Konva.Rect({
        x: 22,
        y: 8,
        width: 10,
        height: 8,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 2,
      }),
    )
    addLine([12, 12, 22, 12])
    addLine([20, 10, 22, 12, 20, 14])
    return group
  }

  if (typeId === 'shore-inlet') {
    group.add(
      new Konva.Rect({
        x: 8,
        y: 6,
        width: 18,
        height: 14,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 3,
      }),
    )
    addLine([13, 9, 13, 16])
    addLine([19, 9, 19, 16])
    return group
  }

  if (typeId === 'ac-dc-charger') {
    group.add(
      new Konva.Rect({
        x: 2,
        y: 4,
        width: 30,
        height: 16,
        fill: iconFill,
        stroke: iconStroke,
        strokeWidth: 1.2,
        cornerRadius: 3,
      }),
    )
    addLine([6, 12, 8, 8, 10, 12, 12, 16, 14, 12])
    addLine([18, 10, 26, 10])
    addLine([18, 14, 26, 14])
    return group
  }

  return null
}

const updateNodeIcon = (node: Konva.Group, typeId: string) => {
  const existing = node.findOne<Konva.Group>('.node-icon')
  const currentTypeId = node.getAttr('iconTypeId')
  if (currentTypeId === typeId && existing) return
  if (existing) existing.destroy()

  const icon = buildNodeIcon(typeId)
  if (icon) {
    node.add(icon)
    icon.zIndex(1)
  }

  node.setAttr('iconTypeId', typeId)
}

const buildIssueMaps = () => {
  const componentIssues = new Map<string, 'warning' | 'error'>()
  const cableIssues = new Map<string, 'warning' | 'error'>()

  schemaStore.issues.forEach((issue) => {
    const targetMap = issue.targetType === 'cable' ? cableIssues : componentIssues
    const current = targetMap.get(issue.targetId)
    if (current === 'error') return
    targetMap.set(issue.targetId, issue.level)
  })

  return { componentIssues, cableIssues }
}

const getDropPosition = (event: DragEvent) => {
  if (!container.value || !stage) return null
  const rect = container.value.getBoundingClientRect()
  const pointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
  const scale = stage.scaleX() || 1
  const x = (pointer.x - stage.x()) / scale - nodeWidth / 2
  const y = (pointer.y - stage.y()) / scale - nodeHeight / 2
  return { x, y }
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

const onDragEnter = () => {
  isDragOver.value = true
}

const onDragLeave = () => {
  isDragOver.value = false
}

const onDrop = (event: DragEvent) => {
  isDragOver.value = false
  const typeId = event.dataTransfer?.getData('application/x-van-elec-component')
  if (!typeId) return
  const position = getDropPosition(event)
  if (!position) return
  schemaStore.addComponentFromType(typeId, position)
}

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

    const badge = cableBadgeMap.get(cableId)
    if (badge) {
      badge.position({
        x: (sourceCenter.x + targetCenter.x) / 2,
        y: (sourceCenter.y + targetCenter.y) / 2,
      })
    }
  })
}

const applySelection = () => {
  const selectedComponentId = schemaStore.schema.selection.componentId
  const selectedCableId = schemaStore.schema.selection.cableId
  const pendingId = pendingSourceId.value

  nodeMap.forEach((node, nodeId) => {
    const rect = node.findOne<Konva.Rect>('.node-rect')
    if (!rect) return
    const isSelected = nodeId === selectedComponentId
    const isPending = nodeId === pendingId
    rect.stroke(isPending ? '#4c7d6b' : isSelected ? '#d96b3a' : '#2d2a25')
    rect.shadowOpacity(isSelected || isPending ? 0.3 : 0.15)
  })

  lineMap.forEach((line, cableId) => {
    const isSelected = cableId === selectedCableId
    line.stroke(isSelected ? '#d96b3a' : '#2d2a25')
    line.strokeWidth(isSelected ? 3.5 : 2)
  })
}

const applyIssueBadges = () => {
  const { componentIssues, cableIssues } = buildIssueMaps()

  nodeMap.forEach((node, nodeId) => {
    const badge = node.findOne<Konva.Circle>('.issue-badge')
    if (!badge) return
    const level = componentIssues.get(nodeId)
    if (!level) {
      badge.visible(false)
      return
    }
    badge.visible(true)
    badge.fill(issueColor(level))
  })

  cableBadgeMap.forEach((badge, cableId) => {
    const level = cableIssues.get(cableId)
    if (!level) {
      badge.visible(false)
      return
    }
    badge.visible(true)
    badge.fill(issueColor(level))
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

  const badge = new Konva.Circle({
    x: nodeWidth - 14,
    y: 14,
    radius: 6,
    fill: '#f2b46d',
    stroke: '#ffffff',
    strokeWidth: 1,
    visible: false,
    name: 'issue-badge',
  })

  group.add(rect)
  group.add(title)
  group.add(badge)

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
      applySelection()
      layer?.batchDraw()
      return
    }

    if (props.mode === 'connect') {
      if (!pendingSourceId.value) {
        pendingSourceId.value = componentId
        schemaStore.setSelection({ componentId })
        applySelection()
        layer?.batchDraw()
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
      applySelection()
      layer?.batchDraw()
      return
    }

    schemaStore.setSelection({ componentId })
    applySelection()
    layer?.batchDraw()
  }

  group.on('click tap', (event) => {
    event.cancelBubble = true
    handleNodeClick(event)
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
  layer?.add(badge)
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

  const currentComponentIds = new Set(
    schemaStore.schema.components.map((component) => component.id),
  )
  const currentCableIds = new Set(schemaStore.schema.cables.map((cable) => cable.id))

  schemaStore.schema.components.forEach((component) => {
    const node = ensureNode(component.id)
    node.position({ x: component.position.x, y: component.position.y })
    const title = node.findOne<Konva.Text>('.node-title')
    if (title) title.text(component.name || component.id)
    updateNodeIcon(node, component.typeId)
    node.zIndex(3)
  })

  schemaStore.schema.cables.forEach((cable) => {
    const line = ensureCable(cable.id)
    line.zIndex(1)
    ensureCableBadge(cable.id)
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

  cableBadgeMap.forEach((badge, cableId) => {
    if (!currentCableIds.has(cableId)) {
      badge.destroy()
      cableBadgeMap.delete(cableId)
    }
  })

  syncCableLines()
  applySelection()
  applyIssueBadges()
  layer.batchDraw()
}

const initStage = () => {
  if (!container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  if (width === 0 || height === 0) {
    requestAnimationFrame(() => initStage())
    return
  }

  stage = new Konva.Stage({
    container: container.value,
    width,
    height,
  })

  stage.draggable(true)
  stage.on('dragstart', () => {
    isPanning.value = true
  })
  stage.on('dragend', () => {
    isPanning.value = false
  })
  stage.on('wheel', (event) => {
    if (!stage) return
    event.evt.preventDefault()
    const oldScale = stage.scaleX() || 1
    const direction = event.evt.deltaY > 0 ? -1 : 1
    const scaleFactor = 1.08
    const newScale = direction > 0 ? oldScale * scaleFactor : oldScale / scaleFactor
    const pointer = stage.getPointerPosition()
    applyZoom(newScale, pointer || undefined)
  })
  stage.on('click tap', (event) => {
    if (stage?.isDragging()) return
    if (event.target !== stage) return
    if (pendingSourceId.value) {
      pendingSourceId.value = null
    }
    schemaStore.setSelection({})
    applySelection()
    layer?.batchDraw()
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
    listening: false,
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
  registerKeyboardShortcuts()
}

watch(
  () => schemaStore.schema,
  () => syncScene(),
  { deep: true },
)

watch(
  () => schemaStore.issues,
  () => {
    if (!layer) return
    applyIssueBadges()
    layer.batchDraw()
  },
  { deep: true },
)

watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'connect') {
      pendingSourceId.value = null
      applySelection()
      layer?.batchDraw()
    }
  },
)

onMounted(() => initStage())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stage?.destroy()
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler)
  }
})

const registerKeyboardShortcuts = () => {
  keydownHandler = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomIn()
      return
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomOut()
      return
    }

    if (event.key === '0') {
      event.preventDefault()
      resetView()
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()

    const selectedComponentId = schemaStore.schema.selection.componentId
    const selectedCableId = schemaStore.schema.selection.cableId

    if (selectedComponentId) {
      schemaStore.removeComponent(selectedComponentId)
      pendingSourceId.value = null
      return
    }

    if (selectedCableId) {
      schemaStore.removeCable(selectedCableId)
      return
    }
  }

  window.addEventListener('keydown', keydownHandler)
}

const clampScale = (value: number) => Math.min(maxScale, Math.max(minScale, value))

const applyZoom = (value: number, anchor?: { x: number; y: number }) => {
  if (!stage) return
  const newScale = clampScale(value)
  const oldScale = stage.scaleX() || 1
  const focus = anchor || { x: stage.width() / 2, y: stage.height() / 2 }
  const pointTo = {
    x: (focus.x - stage.x()) / oldScale,
    y: (focus.y - stage.y()) / oldScale,
  }
  const newPos = {
    x: focus.x - pointTo.x * newScale,
    y: focus.y - pointTo.y * newScale,
  }

  stage.scale({ x: newScale, y: newScale })
  stage.position(newPos)
  zoomLevel.value = Number(newScale.toFixed(2))
  stage.batchDraw()
}

const zoomIn = () => applyZoom(zoomLevel.value + zoomStep)
const zoomOut = () => applyZoom(zoomLevel.value - zoomStep)

const resetView = () => {
  if (!stage) return
  stage.scale({ x: 1, y: 1 })
  stage.position({ x: 0, y: 0 })
  zoomLevel.value = 1
  stage.batchDraw()
}

const onZoomInput = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  const value = Number.parseFloat(target.value)
  if (Number.isNaN(value)) return
  applyZoom(value)
}
</script>
