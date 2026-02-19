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
          <div class="calculation-mode">
            <label class="calculation-mode__label" for="calculation-mode">Current basis</label>
            <select id="calculation-mode" v-model="currentComputationMode" class="calculation-mode__select">
              <option value="load_simulation">Load simulation</option>
              <option value="cable_sizing">Cable sizing</option>
            </select>
            <label class="calculation-mode__checkbox">
              <input
                v-model="autoCableGauge"
                type="checkbox"
                :disabled="!isCableSizingMode"
              >
              <span>Auto cable gauge (125% sizing margin)</span>
            </label>
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
const currentComputationMode = computed({
  get: () => schemaStore.schema.scenario?.currentComputationMode ?? 'load_simulation',
  set: (value: 'load_simulation' | 'cable_sizing') => {
    schemaStore.setCurrentComputationMode(value)
  },
})
const isCableSizingMode = computed(() => currentComputationMode.value === 'cable_sizing')
const autoCableGauge = computed({
  get: () => schemaStore.schema.scenario?.autoCableGauge ?? false,
  set: (value: boolean) => {
    schemaStore.setAutoCableGauge(value)
  },
})

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

<style scoped>
.calculation-mode {
  display: grid;
  gap: 6px;
}

.calculation-mode__label {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6a635c;
}

.calculation-mode__select {
  border: 1px solid rgba(45, 42, 37, 0.18);
  border-radius: 12px;
  padding: 10px 12px;
  font-weight: 500;
  background: #fff;
  color: #2d2a25;
}

.calculation-mode__checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #4a453f;
}

.calculation-mode__checkbox input {
  accent-color: #2d2a25;
}

.calculation-mode__checkbox input:disabled + span {
  opacity: 0.55;
}

.inspector-header {
  display: grid;
  gap: 10px;
}
</style>
