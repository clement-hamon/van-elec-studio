<template>
  <div ref="container" class="canvas-stage" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Konva from 'konva'

const container = ref<HTMLDivElement | null>(null)

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let resizeObserver: ResizeObserver | null = null

const initStage = () => {
  if (!container.value) return

  stage = new Konva.Stage({
    container: container.value,
    width: container.value.clientWidth,
    height: container.value.clientHeight,
  })

  layer = new Konva.Layer()
  stage.add(layer)

  const background = new Konva.Rect({
    x: 0,
    y: 0,
    width: stage.width(),
    height: stage.height(),
    fill: '#111111',
    opacity: 0.02,
  })
  layer.add(background)

  const batteryNode = new Konva.Group({
    x: 120,
    y: 120,
    draggable: true,
  })

  batteryNode.add(
    new Konva.Rect({
      width: 140,
      height: 80,
      fill: '#f6f1e6',
      stroke: '#2d2a25',
      strokeWidth: 1.5,
      cornerRadius: 12,
      shadowColor: '#2d2a25',
      shadowBlur: 12,
      shadowOpacity: 0.15,
      shadowOffset: { x: 0, y: 6 },
    }),
  )

  batteryNode.add(
    new Konva.Text({
      x: 18,
      y: 20,
      text: 'Battery 12V',
      fontSize: 16,
      fontFamily: 'Space Grotesk, sans-serif',
      fill: '#2d2a25',
    }),
  )

  layer.add(batteryNode)
  layer.draw()

  resizeObserver = new ResizeObserver(() => {
    if (!stage || !container.value) return
    stage.size({
      width: container.value.clientWidth,
      height: container.value.clientHeight,
    })
    background.width(stage.width())
    background.height(stage.height())
    stage.batchDraw()
  })

  resizeObserver.observe(container.value)
}

onMounted(() => initStage())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stage?.destroy()
})
</script>

