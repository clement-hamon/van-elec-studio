<template>
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
        @click="emit('zoom-out')"
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
      >
      <button
        class="canvas-zoom__btn"
        type="button"
        :disabled="!canZoomIn"
        aria-label="Zoom in"
        @click="emit('zoom-in')"
      >
        +
      </button>
    </div>
    <button class="canvas-zoom__reset" type="button" @click="emit('reset-view')">
      Reset view
    </button>
    <p class="canvas-zoom__hint">Drag the canvas to move around.</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  zoomPercent: number
  zoomLevel: number
  minScale: number
  maxScale: number
  sliderStep: number
  canZoomIn: boolean
  canZoomOut: boolean
}>()

const emit = defineEmits<{
  (event: 'zoom-in' | 'zoom-out' | 'reset-view'): void
  (event: 'zoom-input', value: number): void
}>()

const onZoomInput = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  const value = Number.parseFloat(target.value)
  if (Number.isNaN(value)) return
  emit('zoom-input', value)
}
</script>
