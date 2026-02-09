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
    <CanvasControls
      :zoom-percent="zoomPercent"
      :zoom-level="zoomLevel"
      :min-scale="minScale"
      :max-scale="maxScale"
      :slider-step="sliderStep"
      :can-zoom-in="canZoomIn"
      :can-zoom-out="canZoomOut"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-view="resetView"
      @zoom-input="onZoomInputValue"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import CanvasControls from '~/components/canvas/CanvasControls.vue'
import { NODE_HEIGHT, NODE_WIDTH, type CanvasMode } from '~/components/canvas/items/constants'
import { useCanvasItems } from '~/components/canvas/items/useCanvasItems'
import { useSchemaStore } from '~/stores/schema'

const props = defineProps<{
  mode: CanvasMode
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
let items: ReturnType<typeof useCanvasItems> | null = null

const getDropPosition = (event: DragEvent) => {
  if (!container.value || !stage) return null
  const rect = container.value.getBoundingClientRect()
  const pointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
  const scale = stage.scaleX() || 1
  const x = (pointer.x - stage.x()) / scale - NODE_WIDTH / 2
  const y = (pointer.y - stage.y()) / scale - NODE_HEIGHT / 2
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

  layer = new Konva.Layer()
  stage.add(layer)

  items = useCanvasItems({
    layer,
    schemaStore,
    getMode: () => props.mode,
    pendingSourceId,
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
    items?.applySelection()
    layer?.batchDraw()
  })

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
    items?.syncCableLines()
    stage.batchDraw()
  })

  resizeObserver.observe(container.value)

  items.syncScene()
  registerKeyboardShortcuts()
}

watch(
  () => schemaStore.schema,
  () => items?.syncScene(),
  { deep: true },
)

watch(
  () => schemaStore.issues,
  () => {
    if (!layer) return
    items?.applyIssueBadges()
    layer.batchDraw()
  },
  { deep: true },
)

watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'connect') {
      pendingSourceId.value = null
      items?.applySelection()
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

const onZoomInputValue = (value: number) => {
  applyZoom(value)
}
</script>
