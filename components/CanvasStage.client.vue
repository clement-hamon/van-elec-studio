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
    <div
      v-if="cableChoiceDialog"
      class="cable-choice-overlay"
      @click.self="cancelCableChoice()"
    >
      <div class="cable-choice-modal" role="dialog" aria-modal="true" aria-label="Choose cable type">
        <div class="cable-choice-title">Choose Cable Type</div>
        <div class="cable-choice-subtitle">
          {{ cableChoiceSourceName }} → {{ cableChoiceTargetName }}
        </div>
        <div class="cable-choice-actions">
          <button
            class="cable-choice-button cable-choice-button--pos"
            :disabled="!canChooseConductor('POS')"
            @click="confirmCableChoice('POS')"
          >
            POS (+)
          </button>
          <button
            class="cable-choice-button cable-choice-button--neg"
            :disabled="!canChooseConductor('NEG')"
            @click="confirmCableChoice('NEG')"
          >
            NEG (-)
          </button>
        </div>
        <button class="cable-choice-cancel" @click="cancelCableChoice()">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import CanvasControls from '~/components/canvas/CanvasControls.vue'
import { NODE_HEIGHT, NODE_WIDTH, type CanvasMode } from '~/components/canvas/items/constants'
import { useCanvasItems } from '~/components/canvas/items/useCanvasItems'
import type { CableConductorChoice } from '~/components/canvas/items/useCablePortResolver'
import { useSchemaStore } from '~/stores/schema'
import type { ComponentInstance } from '~/types/schema'

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

type CableChoiceDialog = {
  source: ComponentInstance
  target: ComponentInstance
  availableConductors: CableConductorChoice[]
  resolve: (choice: CableConductorChoice | null) => void
}

const cableChoiceDialog = ref<CableChoiceDialog | null>(null)
const cableChoiceSourceName = computed(() => cableChoiceDialog.value?.source.name ?? '')
const cableChoiceTargetName = computed(() => cableChoiceDialog.value?.target.name ?? '')

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let background: Konva.Rect | null = null
let resizeObserver: ResizeObserver | null = null
let keydownHandler: ((event: KeyboardEvent) => void) | null = null
let items: ReturnType<typeof useCanvasItems> | null = null

const cancelCableChoice = () => {
  if (!cableChoiceDialog.value) return
  const { resolve } = cableChoiceDialog.value
  cableChoiceDialog.value = null
  resolve(null)
}

const confirmCableChoice = (choice: CableConductorChoice) => {
  if (!cableChoiceDialog.value) return
  if (!cableChoiceDialog.value.availableConductors.includes(choice)) return
  const { resolve } = cableChoiceDialog.value
  cableChoiceDialog.value = null
  resolve(choice)
}

const canChooseConductor = (choice: CableConductorChoice) => {
  return cableChoiceDialog.value?.availableConductors.includes(choice) ?? false
}

const promptCableConductor = (payload: {
  source: ComponentInstance
  target: ComponentInstance
  availableConductors: CableConductorChoice[]
}) => {
  if (cableChoiceDialog.value) cancelCableChoice()
  return new Promise<CableConductorChoice | null>((resolve) => {
    cableChoiceDialog.value = {
      source: payload.source,
      target: payload.target,
      availableConductors: payload.availableConductors,
      resolve,
    }
  })
}

const updateBackground = () => {
  if (!stage || !background) return
  const scale = stage.scaleX() || 1
  const stagePos = stage.position()
  
  // Calculate the visible area in the transformed coordinate system
  const visibleArea = {
    x: -stagePos.x / scale,
    y: -stagePos.y / scale,
    width: stage.width() / scale,
    height: stage.height() / scale,
  }
  
  background.position({ x: visibleArea.x, y: visibleArea.y })
  background.size({ width: visibleArea.width, height: visibleArea.height })
}

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
    onRequestCableConductor: promptCableConductor,
  })

  stage.draggable(true)
  stage.on('dragstart', () => {
    isPanning.value = true
  })
  stage.on('dragend', () => {
    isPanning.value = false
    updateBackground()
  })
  stage.on('dragmove', () => {
    updateBackground()
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
    updateBackground()
  })
  stage.on('click tap', (event) => {
    if (stage?.isDragging()) return
    if (event.target !== stage) return
    if (cableChoiceDialog.value) {
      cancelCableChoice()
      return
    }
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
  updateBackground()

  resizeObserver = new ResizeObserver(() => {
    if (!stage || !container.value || !background) return
    stage.size({
      width: container.value.clientWidth,
      height: container.value.clientHeight,
    })
    updateBackground()
    items?.syncCableLines()
    stage.batchDraw()
  })

  resizeObserver.observe(container.value)

  items.syncScene()
  items.applyFlowIndicators()
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
  () => schemaStore.flow,
  () => {
    if (!layer) return
    items?.applyFlowIndicators()
    layer.batchDraw()
  },
  { deep: true },
)

watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'connect') {
      cancelCableChoice()
      pendingSourceId.value = null
      items?.applySelection()
      layer?.batchDraw()
    }
  },
)

onMounted(() => initStage())

onBeforeUnmount(() => {
  cancelCableChoice()
  resizeObserver?.disconnect()
  stage?.destroy()
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler)
  }
})

const registerKeyboardShortcuts = () => {
  keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && cableChoiceDialog.value) {
      event.preventDefault()
      cancelCableChoice()
      return
    }
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
  updateBackground()
  stage.batchDraw()
}

const zoomIn = () => applyZoom(zoomLevel.value + zoomStep)
const zoomOut = () => applyZoom(zoomLevel.value - zoomStep)

const resetView = () => {
  if (!stage) return
  stage.scale({ x: 1, y: 1 })
  stage.position({ x: 0, y: 0 })
  zoomLevel.value = 1
  updateBackground()
  stage.batchDraw()
}

const onZoomInputValue = (value: number) => {
  applyZoom(value)
}
</script>

<style scoped>
.canvas-stage-shell {
  position: relative;
}

.cable-choice-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 20, 16, 0.22);
  z-index: 20;
}

.cable-choice-modal {
  min-width: 240px;
  max-width: 320px;
  border-radius: 12px;
  background: #fffaf2;
  border: 1px solid #d7c9b9;
  box-shadow: 0 12px 24px rgba(22, 18, 14, 0.18);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.cable-choice-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: #2d2a25;
}

.cable-choice-subtitle {
  font-size: 0.8rem;
  color: #6a5f55;
}

.cable-choice-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.cable-choice-button {
  height: 36px;
  border-radius: 8px;
  border: 1px solid #cdb9a5;
  background: #f6efe4;
  color: #2d2a25;
  font-weight: 600;
  cursor: pointer;
}

.cable-choice-button--pos {
  border-color: #d88f82;
}

.cable-choice-button--neg {
  border-color: #7da6d8;
}

.cable-choice-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cable-choice-cancel {
  height: 34px;
  border: 1px solid #d2c4b4;
  border-radius: 8px;
  background: #fff;
  color: #4b4036;
  cursor: pointer;
}
</style>
