<template>
  <div class="workspace">
    <aside class="panel panel-left">
      <div class="panel-header">
        <h2>Library</h2>
        <p>Drag components into the canvas.</p>
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
      <div class="canvas-toolbar">
        <button
          class="btn btn-ghost"
          :class="{ 'btn-active': mode === 'select' }"
          type="button"
          @click="mode = 'select'"
        >
          Select
        </button>
        <button
          class="btn btn-ghost"
          :class="{ 'btn-active': mode === 'connect' }"
          type="button"
          @click="mode = 'connect'"
        >
          Connect
        </button>
        <button class="btn btn-ghost" type="button" disabled>Group</button>
      </div>
      <ClientOnly>
        <CanvasStage :mode="mode" />
        <template #fallback>
          <div class="canvas-stage canvas-fallback">Loading canvas...</div>
        </template>
      </ClientOnly>
    </section>

    <aside class="panel panel-right">
      <div class="panel-header">
        <h2>Inspector</h2>
        <p>{{ inspectorDescription }}</p>
      </div>
      <div class="panel-body">
        <InspectorPanel />
      </div>
    </aside>

    <footer class="panel panel-bottom">
      <div class="panel-header">
        <h2>Validation</h2>
        <p>Issues and suggested fixes will appear here.</p>
      </div>
      <div class="panel-body">
        <div v-if="issues.length === 0" class="issue">
          <span class="issue-tag issue-ok">Ok</span>
          No issues detected.
        </div>
        <div v-for="issue in issues" :key="issue.id" class="issue">
          <span
            class="issue-tag"
            :class="issue.level === 'error' ? 'issue-error' : 'issue-warning'"
          >
            {{ issue.level }}
          </span>
          {{ issue.message }}
          <span v-if="issue.suggestion" class="issue-suggestion">{{ issue.suggestion }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSchemaStore } from '~/stores/schema'
import CanvasStage from '~/components/CanvasStage.client.vue'
import InspectorPanel from '~/components/InspectorPanel.vue'

const schemaStore = useSchemaStore()

const issues = computed(() => schemaStore.issues)
const mode = ref<'select' | 'connect'>('select')
const libraryItems = computed(() => schemaStore.registry)
const selectedComponent = computed(() => schemaStore.selectedComponent)
const selectedCable = computed(() => schemaStore.selectedCable)

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
