<template>
  <section class="inspector-summary">
    <div class="summary-block">
      <div class="summary-header">
        <div class="summary-title">Cables</div>
        <div class="summary-count">{{ cables.length }}</div>
      </div>
      <div v-if="cables.length === 0" class="empty-state">
        No cables yet. Connect components to add one.
      </div>
      <div v-else class="summary-list">
        <div v-for="group in groupedByGauge" :key="group.key" class="summary-card">
          <div class="summary-card-header">
            <div class="summary-card-title">{{ formatCableGauge(group.gaugeAwg) }}</div>
            <span class="summary-badge">x{{ group.count }}</span>
          </div>
          <div class="summary-lengths">
            <div
              v-for="lengthGroup in group.lengthGroups"
              :key="lengthGroup.key"
              class="summary-length-row"
            >
              <div class="summary-length-label">
                {{ formatCableLength(lengthGroup.lengthM) }}
              </div>
              <span class="summary-badge summary-badge-soft">x{{ lengthGroup.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Cable } from '~/types/schema'

const props = defineProps<{ cables: Cable[] }>()

type LengthGroup = {
  key: string
  lengthM?: number
  count: number
}

type GaugeGroup = {
  key: string
  gaugeAwg?: number
  count: number
  lengthGroups: LengthGroup[]
}

const groupedByGauge = computed<GaugeGroup[]>(() => {
  const byGauge = new Map<
    string,
    { gaugeAwg?: number; count: number; lengths: Map<string, LengthGroup> }
  >()

  props.cables.forEach((cable) => {
    const gaugeAwg = normalizeNumber(cable.props?.gaugeAwg)
    const lengthM = normalizeNumber(cable.props?.lengthM)
    const gaugeKey = `${gaugeAwg ?? 'na'}`
    const lengthKey = `${lengthM ?? 'na'}`

    let gaugeGroup = byGauge.get(gaugeKey)
    if (!gaugeGroup) {
      gaugeGroup = { gaugeAwg: gaugeAwg ?? undefined, count: 0, lengths: new Map() }
      byGauge.set(gaugeKey, gaugeGroup)
    }

    gaugeGroup.count += 1
    const existingLength = gaugeGroup.lengths.get(lengthKey)
    if (existingLength) {
      existingLength.count += 1
    } else {
      gaugeGroup.lengths.set(lengthKey, {
        key: `${gaugeKey}|${lengthKey}`,
        lengthM: lengthM ?? undefined,
        count: 1,
      })
    }
  })

  return Array.from(byGauge.entries())
    .map(([key, group]) => ({
      key,
      gaugeAwg: group.gaugeAwg,
      count: group.count,
      lengthGroups: Array.from(group.lengths.values()).sort((a, b) => {
        const lengthA = a.lengthM ?? Number.POSITIVE_INFINITY
        const lengthB = b.lengthM ?? Number.POSITIVE_INFINITY
        return lengthA - lengthB
      }),
    }))
    .sort((a, b) => {
      const gaugeA = a.gaugeAwg ?? Number.POSITIVE_INFINITY
      const gaugeB = b.gaugeAwg ?? Number.POSITIVE_INFINITY
      return gaugeA - gaugeB
    })
})

const normalizeNumber = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const formatCableLength = (lengthM?: number) => {
  if (typeof lengthM !== 'number' || !Number.isFinite(lengthM)) return '0.0 m'
  return `${lengthM.toFixed(1)} m`
}

const formatCableGauge = (gaugeAwg?: number) => {
  if (typeof gaugeAwg !== 'number' || !Number.isFinite(gaugeAwg)) return 'n/a'
  return `${Math.round(gaugeAwg)} AWG`
}
</script>

<style scoped>
.inspector-summary {
  gap: 12px;
}

.summary-block {
  display: grid;
  gap: 12px;
}

.summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.summary-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #2d2a25;
}

.summary-count {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(45, 42, 37, 0.08);
  color: #5a554f;
}

.summary-list {
  display: grid;
  gap: 10px;
}

.summary-card {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(45, 42, 37, 0.12);
  background: #fffaf2;
}

.summary-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.summary-card-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: #2d2a25;
}

.summary-badge {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(217, 107, 58, 0.15);
  color: #6a4b3b;
}

.summary-badge-soft {
  background: rgba(45, 42, 37, 0.08);
  color: #5a554f;
}

.summary-lengths {
  display: grid;
  gap: 6px;
}

.summary-length-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(45, 42, 37, 0.05);
  border-radius: 10px;
  padding: 6px 10px;
}

.summary-length-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #2d2a25;
  font-variant-numeric: tabular-nums;
}
</style>
