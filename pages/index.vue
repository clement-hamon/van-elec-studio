<template>
  <div class="workspace">
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
          <div class="add-component">
              <select
                v-model="selectedTypeId"
                class="btn btn-primary add-component__select"
                aria-label="Select a component to add"
                @change="onAddSelected"
              >
                <option value="" disabled>Add a component</option>
                <option v-for="item in libraryItems" :key="item.id" :value="item.id">
                  {{ item.label }}
                </option>
              </select>
          </div>
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
const isAddMenuOpen = ref(false)
const selectedTypeId = ref('')

const inspectorTitle = computed(() => {
  if (selectedComponent.value) {
    const type = schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId)
    return type?.label ?? 'Component'
  }

  if (selectedCable.value) return 'Cable'

  return 'Components'
})

const addComponent = (typeId: string) => {
  schemaStore.addComponentFromType(typeId)
}

const onAddSelected = () => {
  if (!selectedTypeId.value) return
  addComponent(selectedTypeId.value)
  selectedTypeId.value = ''
  isAddMenuOpen.value = false
}
</script>
