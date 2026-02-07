<template>
  <div class="workspace">
    <aside class="panel panel-left">
      <div class="panel-header">
        <h2>Library</h2>
        <p>Drag components to the canvas.</p>
      </div>
      <div class="panel-body">
        <button
          v-for="item in libraryItems"
          :key="item.id"
          class="list-item"
          type="button"
          draggable="true"
          @dragstart="onDragStart($event, item.id)"
          @click="addComponent(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </aside>

    <section class="canvas-area">
      <ClientOnly>
        <CanvasStage :mode="mode" />
        <template #fallback>
          <div class="canvas-stage canvas-fallback">Loading canvas...</div>
        </template>
      </ClientOnly>
    </section>

    <aside class="panel panel-right">
      <div class="panel-header">
        <div v-if="inspectorTitle" class="inspector-header">
          <h2>{{ inspectorTitle }}</h2>
          <p>{{ inspectorDescription }}</p>
        </div>
        <div v-else>
          <h2>Inspector</h2>
          <p>Select a component or cable to view details.</p>
        </div>
      </div>
      <div class="panel-body">
        <InspectorPanel />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSchemaStore } from '~/stores/schema'
import CanvasStage from '~/components/CanvasStage.client.vue'
import InspectorPanel from '~/components/InspectorPanel.vue'

const schemaStore = useSchemaStore()

const mode = ref<'select' | 'connect'>('select')
const libraryItems = computed(() => schemaStore.registry)
const selectedComponent = computed(() => schemaStore.selectedComponent)
const selectedCable = computed(() => schemaStore.selectedCable)

const inspectorTitle = computed(() => {
  if (selectedComponent.value) {
    const type = schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId)
    return type?.label ?? 'Component'
  }

  if (selectedCable.value) return 'Cable'

  return ''
})

const inspectorDescription = computed(() => {
  if (selectedComponent.value) {
    const type = schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId)
    return type?.description ?? 'Set properties for the selected component.'
  }

  if (selectedCable.value) {
    return 'Edit cable properties and derived values.'
  }

  return 'Set properties for the selected item.'
})

const addComponent = (typeId: string) => {
  schemaStore.addComponentFromType(typeId)
}

const onDragStart = (event: DragEvent, typeId: string) => {
  event.dataTransfer?.setData('application/x-van-elec-component', typeId)
  event.dataTransfer?.setData('text/plain', typeId)
}
</script>
