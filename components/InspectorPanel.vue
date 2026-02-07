<template>
  <div>
    <div v-if="!selectedComponent && !selectedCable" class="empty-state">
      Select a component or cable to edit its properties.
    </div>

    <div v-if="selectedIssues.length > 0" class="issue-panel">
      <h3>Issues</h3>
      <div v-for="issue in selectedIssues" :key="issue.id" class="issue-row">
        <span class="issue-tag" :class="issue.level === 'error' ? 'issue-error' : 'issue-warning'">
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

      <div v-if="showChargeSummary" class="field field-readonly">
        <label>Charge Summary</label>
        <div class="derived">
          <div>Available current: {{ chargeAvailableA }} A</div>
          <div>Effective current: {{ chargeEffectiveA }} A</div>
          <div>Time to full: {{ chargeTimeToFull }}</div>
        </div>
      </div>

      <div v-if="componentFields.length === 0" class="empty-state">
        No editable fields for this component.
      </div>

      <div v-for="field in componentFields" :key="field.key" class="field">
        <label :for="fieldId(field.key)">{{ field.label }}</label>
        <input
          v-if="field.type === 'number'"
          :id="fieldId(field.key)"
          type="number"
          :step="field.step ?? 1"
          :value="componentFieldValue(field)"
          @input="onComponentFieldInput(field, $event)"
        >
        <input
          v-else-if="field.type === 'text'"
          :id="fieldId(field.key)"
          type="text"
          :value="componentFieldValue(field)"
          @input="onComponentFieldInput(field, $event)"
        >
        <select
          v-else-if="field.type === 'select'"
          :id="fieldId(field.key)"
          :value="String(componentFieldValue(field))"
          @change="onComponentFieldInput(field, $event)"
        >
          <option
            v-for="option in field.options ?? []"
            :key="String(option.value)"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSchemaStore } from '~/stores/schema'
import { awgToMm2 } from '~/services/cable'
import type { ComponentFieldDefinition } from '~/types/schema'

const schemaStore = useSchemaStore()

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

const componentType = computed(() => {
  if (!selectedComponent.value) return null
  return schemaStore.registry.find((item) => item.id === selectedComponent.value?.typeId) ?? null
})

const componentFields = computed(() => componentType.value?.fields ?? [])
const showChargeSummary = computed(
  () => componentType.value?.chargePathRole === 'battery' || componentType.value?.id === 'battery',
)

const componentName = computed({
  get: () => selectedComponent.value?.name ?? '',
  set: (value: string) => {
    if (!selectedComponent.value) return
    schemaStore.updateComponent(selectedComponent.value.id, { name: value })
  },
})

const fieldId = (key: string) => `component-field-${key}`

const componentFieldValue = (field: ComponentFieldDefinition) => {
  if (!selectedComponent.value) return ''
  const value = selectedComponent.value.props[field.key]
  if (value === undefined || value === null) return ''
  return value
}

const chargeAvailableA = computed(() => {
  const value = selectedComponent.value?.derived?.chargeAvailableA
  if (typeof value === 'number') return value.toFixed(1)
  return '0.0'
})

const chargeEffectiveA = computed(() => {
  const value = selectedComponent.value?.derived?.chargeEffectiveA
  if (typeof value === 'number') return value.toFixed(1)
  return '0.0'
})

const chargeTimeToFull = computed(() => {
  const value = selectedComponent.value?.derived?.timeToFullH
  if (typeof value === 'number') return `${value.toFixed(1)} h`
  if (typeof value === 'string') return value
  return 'n/a'
})

const coerceFieldValue = (field: ComponentFieldDefinition, rawValue: string) => {
  if (field.type === 'number') {
    if (rawValue === '') return null
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (field.type === 'select' && field.options) {
    const match = field.options.find((option) => String(option.value) === rawValue)
    return match ? match.value : rawValue
  }

  return rawValue
}

const onComponentFieldInput = (field: ComponentFieldDefinition, event: Event) => {
  if (!selectedComponent.value) return
  const target = event.target as HTMLInputElement | HTMLSelectElement | null
  if (!target) return

  const value = coerceFieldValue(field, target.value)
  if (value === null) return

  schemaStore.updateComponent(selectedComponent.value.id, {
    props: { ...selectedComponent.value.props, [field.key]: value },
  })
}

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
