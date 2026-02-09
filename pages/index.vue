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
        <div class="inspector-header">
          <h2>{{ inspectorTitle }}</h2>
          <p>{{ inspectorDescription }}</p>
        </div>
      </div>
      <div class="panel-body">
        <SchemaSummary v-if="showSchemaSummary" :cables="schemaCables" />
        <InspectorPanel v-else />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSchemaStore } from '~/stores/schema'
import CanvasStage from '~/components/CanvasStage.client.vue'
import InspectorPanel from '~/components/InspectorPanel.vue'
import SchemaSummary from '~/components/SchemaSummary.vue'

const schemaStore = useSchemaStore()

const mode = ref<'select' | 'connect'>('select')
const libraryItems = computed(() => schemaStore.registry)
const selectedComponent = computed(() => schemaStore.selectedComponent)
const selectedCable = computed(() => schemaStore.selectedCable)
const showSchemaSummary = computed(() => !selectedComponent.value && !selectedCable.value)
const schemaCables = computed(() => schemaStore.schema.cables)

const inspectorTitle = computed(() => {
  if (selectedComponent.value) {
    const type = schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId)
    return type?.label ?? 'Component'
  }

  if (selectedCable.value) return 'Cable'

  return 'Schema Components'
})

const inspectorDescription = computed(() => {
  if (selectedComponent.value) {
    const type = schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId)
    return type?.description ?? 'Set properties for the selected component.'
  }

  if (selectedCable.value) {
    return 'Edit cable properties and derived values.'
  }

  return null
})

const addComponent = (typeId: string) => {
  schemaStore.addComponentFromType(typeId)
}

const onDragStart = (event: DragEvent, typeId: string) => {
  event.dataTransfer?.setData('application/x-van-elec-component', typeId)
  event.dataTransfer?.setData('text/plain', typeId)
}
</script>
