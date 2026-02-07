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
        <p>Set properties for the selected item.</p>
      </div>
      <div class="panel-body">
        <div v-if="!selectedComponent && !selectedCable" class="empty-state">
          Select a component or cable to edit its properties.
        </div>

        <div v-if="selectedIssues.length > 0" class="issue-panel">
          <h3>Issues</h3>
          <div v-for="issue in selectedIssues" :key="issue.id" class="issue-row">
            <span
              class="issue-tag"
              :class="issue.level === 'error' ? 'issue-error' : 'issue-warning'"
            >
              {{ issue.level }}
            </span>
            <div class="issue-text">
              <div>{{ issue.message }}</div>
              <div v-if="issue.suggestion" class="issue-suggestion">
                {{ issue.suggestion }}
              </div>
            </div>
          </div>
        </div>

        <template v-if="selectedComponent">
          <div class="field">
            <label for="component-name">Name</label>
            <input id="component-name" v-model="componentName" type="text" >
          </div>
          <div v-if="componentVoltage !== null" class="field">
            <label for="voltage">Voltage (V)</label>
            <input id="voltage" v-model.number="componentVoltage" type="number" step="0.1" >
          </div>
          <div v-if="componentOperatingVoltage !== null" class="field">
            <label for="operating-voltage">Operating Voltage (V)</label>
            <input
              id="operating-voltage"
              v-model.number="componentOperatingVoltage"
              type="number"
              step="0.1"
            >
          </div>
          <div v-if="componentCapacity !== null" class="field">
            <label for="capacity">Capacity (Ah)</label>
            <input id="capacity" v-model.number="componentCapacity" type="number" step="1" >
          </div>
          <div v-if="componentWatt !== null" class="field">
            <label for="watt">Power (W)</label>
            <input id="watt" v-model.number="componentWatt" type="number" step="1" >
          </div>
          <div v-if="componentRating !== null" class="field">
            <label for="rating">Rating (A)</label>
            <input id="rating" v-model.number="componentRating" type="number" step="1" >
          </div>
        </template>

        <template v-if="selectedCable">
          <div class="field">
            <label for="cable-name">Cable Name</label>
            <input id="cable-name" v-model="cableName" type="text" >
          </div>
          <div class="field">
            <label for="length">Cable Length (m)</label>
            <input id="length" v-model.number="cableLength" type="number" step="0.1" >
          </div>
          <div class="field">
            <label for="gauge">Gauge (AWG)</label>
            <input id="gauge" v-model.number="cableGauge" type="number" step="1" >
          </div>
          <div class="field field-readonly">
            <label>Gauge (mm²)</label>
            <div class="derived">{{ cableGaugeMm2 }} mm²</div>
          </div>
          <div class="field field-readonly">
            <label>Derived</label>
            <div class="derived">
              <div>Expected current: {{ cableExpectedCurrent }} A</div>
              <div>Downstream power: {{ cableExpectedPower }} W</div>
              <div>Circuit voltage: {{ cableCircuitVoltage }} V</div>
              <div>Ampacity: {{ cableAmpacity }} A</div>
              <div>Voltage drop: {{ cableVoltageDrop }} V</div>
            </div>
          </div>
        </template>
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
import { awgToMm2 } from '~/services/cable'

const schemaStore = useSchemaStore()

const issues = computed(() => schemaStore.issues)
const mode = ref<'select' | 'connect'>('select')
const libraryItems = computed(() => schemaStore.registry)

const addComponent = (typeId: string) => {
  schemaStore.addComponentFromType(typeId)
}

const onDragStart = (event: DragEvent, typeId: string) => {
  event.dataTransfer?.setData('application/x-van-elec-component', typeId)
  event.dataTransfer?.setData('text/plain', typeId)
}

const selectedComponent = computed(() => schemaStore.selectedComponent)
const selectedCable = computed(() => schemaStore.selectedCable)

const selectedIssues = computed(() => {
  const componentId = selectedComponent.value?.id
  const cableId = selectedCable.value?.id
  if (!componentId && !cableId) return []
  return schemaStore.issues.filter((issue) => {
    if (issue.targetType === 'component') return issue.targetId === componentId
    if (issue.targetType === 'cable') return issue.targetId === cableId
    return false
  })
})

const componentName = computed({
  get: () => selectedComponent.value?.name ?? '',
  set: (value: string) => {
    if (!selectedComponent.value) return
    schemaStore.updateComponent(selectedComponent.value.id, { name: value })
  },
})

const componentVoltage = computed({
  get: () => {
    const voltage = selectedComponent.value?.props.voltage
    return typeof voltage === 'number' ? voltage : null
  },
  set: (value: number | null) => {
    if (!selectedComponent.value || value === null) return
    schemaStore.updateComponent(selectedComponent.value.id, {
      props: { ...selectedComponent.value.props, voltage: value },
    })
  },
})

const componentOperatingVoltage = computed({
  get: () => {
    const operatingVoltage = selectedComponent.value?.props.operatingVoltage
    return typeof operatingVoltage === 'number' ? operatingVoltage : null
  },
  set: (value: number | null) => {
    if (!selectedComponent.value || value === null) return
    schemaStore.updateComponent(selectedComponent.value.id, {
      props: { ...selectedComponent.value.props, operatingVoltage: value },
    })
  },
})

const componentCapacity = computed({
  get: () => {
    const capacity = selectedComponent.value?.props.capacityAh
    return typeof capacity === 'number' ? capacity : null
  },
  set: (value: number | null) => {
    if (!selectedComponent.value || value === null) return
    schemaStore.updateComponent(selectedComponent.value.id, {
      props: { ...selectedComponent.value.props, capacityAh: value },
    })
  },
})

const componentRating = computed({
  get: () => {
    const rating = selectedComponent.value?.props.ratingA
    return typeof rating === 'number' ? rating : null
  },
  set: (value: number | null) => {
    if (!selectedComponent.value || value === null) return
    schemaStore.updateComponent(selectedComponent.value.id, {
      props: { ...selectedComponent.value.props, ratingA: value },
    })
  },
})

const componentWatt = computed({
  get: () => {
    const watt = selectedComponent.value?.props.watt
    return typeof watt === 'number' ? watt : null
  },
  set: (value: number | null) => {
    if (!selectedComponent.value || value === null) return
    schemaStore.updateComponent(selectedComponent.value.id, {
      props: { ...selectedComponent.value.props, watt: value },
    })
  },
})

const cableName = computed({
  get: () => selectedCable.value?.name ?? '',
  set: (value: string) => {
    if (!selectedCable.value) return
    schemaStore.updateCable(selectedCable.value.id, { name: value })
  },
})

const cableLength = computed({
  get: () => selectedCable.value?.props.lengthM ?? 0,
  set: (value: number) => {
    if (!selectedCable.value) return
    schemaStore.updateCable(selectedCable.value.id, {
      props: { ...selectedCable.value.props, lengthM: value },
    })
  },
})

const cableGauge = computed({
  get: () => selectedCable.value?.props.gaugeAwg ?? 0,
  set: (value: number) => {
    if (!selectedCable.value) return
    schemaStore.updateCable(selectedCable.value.id, {
      props: { ...selectedCable.value.props, gaugeAwg: value },
    })
  },
})

const cableGaugeMm2 = computed(() => {
  if (!selectedCable.value) return '0.00'
  return awgToMm2(selectedCable.value.props.gaugeAwg).toFixed(2)
})

const cableExpectedCurrent = computed(() =>
  selectedCable.value ? selectedCable.value.derived.expectedCurrentA.toFixed(1) : '0.0',
)
const cableExpectedPower = computed(() =>
  selectedCable.value ? selectedCable.value.derived.expectedPowerW.toFixed(0) : '0',
)
const cableCircuitVoltage = computed(() =>
  selectedCable.value ? selectedCable.value.derived.circuitVoltageV.toFixed(1) : '0.0',
)
const cableAmpacity = computed(() => selectedCable.value?.derived.ampacityA ?? 0)
const cableVoltageDrop = computed(() =>
  selectedCable.value ? selectedCable.value.derived.voltageDropV.toFixed(2) : '0.00',
)
</script>
