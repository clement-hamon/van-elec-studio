<template>
  <div class="inspector-panel">
    <section v-if="selectedComponent" class="inspector-section">
      <div class="inspector-section-title">Properties</div>
      <div class="field">
        <label for="component-name">Name</label>
        <input id="component-name" v-model="componentName" type="text" >
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
    </section>

    <section v-if="selectedComponent" class="inspector-section">
      <div class="inspector-section-title">Ports</div>
      <div v-if="componentPorts.length === 0" class="empty-state">
        No ports defined for this component.
      </div>
      <div v-else class="port-list">
        <div v-for="port in componentPorts" :key="port.id" class="port-row">
          <div class="port-label">
            {{ port.label ?? port.id }} <span class="port-id">({{ port.id }})</span>
          </div>
          <div class="port-meta">{{ port.dir }} · {{ port.domain.toUpperCase() }} · {{ port.conductor }}</div>
        </div>
      </div>
    </section>

    <section v-if="showScenarioToggle" class="inspector-section">
      <div class="inspector-section-title">Scenario</div>
      <div class="field field-inline">
        <label>Enabled</label>
        <label class="toggle">
          <input v-model="componentEnabled" type="checkbox">
          <span>{{ componentEnabled ? 'On' : 'Off' }}</span>
        </label>
      </div>
    </section>

    <section v-if="selectedCable" class="inspector-section">
      <div class="inspector-section-title">Cable</div>
      <div class="field">
        <label for="cable-name">Cable Name</label>
        <input id="cable-name" v-model="cableName" type="text" >
      </div>
      <div class="field">
        <label for="cable-source-port">Source Port</label>
        <select
          id="cable-source-port"
          :value="cableSourcePortId"
          :disabled="sourcePortOptions.length === 0"
          @change="onSourcePortChange"
        >
          <option v-if="sourcePortOptions.length === 0" value="">No ports</option>
          <option
            v-for="option in sourcePortOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="cable-target-port">Target Port</label>
        <select
          id="cable-target-port"
          :value="cableTargetPortId"
          :disabled="targetPortOptions.length === 0"
          @change="onTargetPortChange"
        >
          <option v-if="targetPortOptions.length === 0" value="">No ports</option>
          <option
            v-for="option in targetPortOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
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
    </section>

    <section v-if="selectedIssues.length > 0" class="inspector-section">
      <div class="inspector-section-title">Issues</div>
      <div class="inspector-issues">
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
    </section>
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

const componentPorts = computed(() => selectedComponent.value?.ports ?? [])

const showScenarioToggle = computed(() => !!selectedComponent.value)

const componentEnabled = computed({
  get: () => (selectedComponent.value ? schemaStore.isComponentEnabled(selectedComponent.value.id) : true),
  set: (value: boolean) => {
    if (!selectedComponent.value) return
    schemaStore.setComponentEnabled(selectedComponent.value.id, value)
  },
})

// const cableDirectionLabel = computed(() => {
//   if (!selectedCable.value) return ''
//   const sourcePort = selectedCable.value.from.portId ? `:${selectedCable.value.from.portId}` : ''
//   const targetPort = selectedCable.value.to.portId ? `:${selectedCable.value.to.portId}` : ''
//   return `${selectedCable.value.from.nodeId}${sourcePort} → ${selectedCable.value.to.nodeId}${targetPort}`
// })

const componentFields = computed(() => componentType.value?.fields ?? [])

const sourceComponent = computed(() => {
  if (!selectedCable.value) return null
  return (
    schemaStore.schema.components.find(
      (component) => component.id === selectedCable.value?.from.nodeId,
    ) ?? null
  )
})

const targetComponent = computed(() => {
  if (!selectedCable.value) return null
  return (
    schemaStore.schema.components.find(
      (component) => component.id === selectedCable.value?.to.nodeId,
    ) ?? null
  )
})

const sourcePortOptions = computed(() => {
  if (!sourceComponent.value) return []
  return sourceComponent.value.ports.map((port) => ({
    value: port.id,
    label: `${port.label ?? port.id} (${port.id})`,
  }))
})

const targetPortOptions = computed(() => {
  if (!targetComponent.value) return []
  return targetComponent.value.ports.map((port) => ({
    value: port.id,
    label: `${port.label ?? port.id} (${port.id})`,
  }))
})

const cableSourcePortId = computed(() => selectedCable.value?.from.portId ?? '')
const cableTargetPortId = computed(() => selectedCable.value?.to.portId ?? '')

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
  const value = selectedComponent.value.params[field.key]
  if (value === undefined || value === null) return ''
  return value
}

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
    params: { ...selectedComponent.value.params, [field.key]: value },
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
  get: () => selectedCable.value?.wire.lengthM ?? 0,
  set: (value: number) => {
    if (!selectedCable.value) return
    schemaStore.updateCable(selectedCable.value.id, {
      wire: { ...selectedCable.value.wire, lengthM: value },
    })
  },
})

const cableGauge = computed({
  get: () => selectedCable.value?.wire.gaugeAwg ?? 0,
  set: (value: number) => {
    if (!selectedCable.value) return
    schemaStore.updateCable(selectedCable.value.id, {
      wire: { ...selectedCable.value.wire, gaugeAwg: value },
    })
  },
})

const cableGaugeMm2 = computed(() => {
  if (!selectedCable.value) return '0.00'
  return awgToMm2(selectedCable.value.wire.gaugeAwg ?? 0).toFixed(2)
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

const onSourcePortChange = (event: Event) => {
  if (!selectedCable.value) return
  const target = event.target as HTMLSelectElement | null
  if (!target) return
  schemaStore.updateCable(selectedCable.value.id, {
    from: { ...selectedCable.value.from, portId: target.value },
  })
}

const onTargetPortChange = (event: Event) => {
  if (!selectedCable.value) return
  const target = event.target as HTMLSelectElement | null
  if (!target) return
  schemaStore.updateCable(selectedCable.value.id, {
    to: { ...selectedCable.value.to, portId: target.value },
  })
}

</script>

<style scoped>

.port-list {
  display: grid;
  gap: 8px;
}

.port-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(45, 42, 37, 0.05);
}

.port-label {
  font-weight: 600;
  font-size: 0.85rem;
  color: #2d2a25;
}

.port-id {
  font-weight: 500;
  color: #8a7f75;
}

.port-meta {
  font-size: 0.75rem;
  color: #6a5f55;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.field-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: #2d2a25;
}

.toggle input {
  accent-color: #2d2a25;
}
</style>
