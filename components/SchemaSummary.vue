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
        <div v-for="group in groupedByGauge" :key="group.key" class="summary-row">
          <div class="summary-cable-stack">
            <div
              v-for="polarity in cablePolarities"
              :key="`${group.key}-${polarity.key}`"
              class="summary-cable-icon"
              :style="cableIconStyle(group.gaugeAwg)"
            >
              <img :src="polarity.icon" :alt="polarity.alt" draggable="false">
              <span class="summary-cable-gauge">{{ formatGaugeSign(group.gaugeAwg) }}</span>
            </div>
          </div>
          <span class="summary-row-count">x{{ group.count }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { awgToMm2 } from '~/services/cable'
import type { Cable } from '~/types/schema'

const props = defineProps<{ cables: Cable[] }>()

type GaugeGroup = {
  key: string
  gaugeAwg?: number
  count: number
}

const groupedByGauge = computed<GaugeGroup[]>(() => {
  const byGauge = new Map<string, { gaugeAwg?: number; count: number }>()

  props.cables.forEach((cable) => {
    const gaugeAwg = normalizeNumber(cable.wire?.gaugeAwg)
    const gaugeKey = `${gaugeAwg ?? 'na'}`

    let gaugeGroup = byGauge.get(gaugeKey)
    if (!gaugeGroup) {
      gaugeGroup = { gaugeAwg: gaugeAwg ?? undefined, count: 0 }
      byGauge.set(gaugeKey, gaugeGroup)
    }

    gaugeGroup.count += 1
  })

  return Array.from(byGauge.entries())
    .map(([key, group]) => ({
      key,
      gaugeAwg: group.gaugeAwg,
      count: group.count,
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
const config = useRuntimeConfig()
const baseURL = config.app.baseURL
const getAssetPath = (path: string, baseURL: string) => {
  return baseURL.endsWith('/') ? `${baseURL}${path.slice(1)}` : `${baseURL}${path}`
}
const getPath = (path: string) => getAssetPath(path, baseURL)

const cablePolarities = [
  { key: 'pos', icon: getPath('/icons/pos-cable.svg'), alt: 'Positive cable' },
  { key: 'neg', icon: getPath('/icons/neg-cable.svg'), alt: 'Negative cable' },
]

const BASE_GAUGE = 8
const BASE_ICON_HEIGHT = 16
const MIN_ICON_HEIGHT = 12
const MAX_ICON_HEIGHT = 24

const toIconHeight = (gaugeAwg?: number) => {
  if (typeof gaugeAwg !== 'number' || !Number.isFinite(gaugeAwg)) {
    return BASE_ICON_HEIGHT
  }
  const area = awgToMm2(gaugeAwg)
  const baseArea = awgToMm2(BASE_GAUGE)
  const ratio = area / baseArea
  const scaled = BASE_ICON_HEIGHT * Math.sqrt(Math.max(0.15, ratio))
  return Math.max(MIN_ICON_HEIGHT, Math.min(MAX_ICON_HEIGHT, Math.round(scaled)))
}

const cableIconStyle = (gaugeAwg?: number) => ({
  height: `${toIconHeight(gaugeAwg)}px`,
})

const formatGaugeSign = (gaugeAwg?: number) => {
  if (typeof gaugeAwg !== 'number' || !Number.isFinite(gaugeAwg)) return 'AWG ?'
  return `Ø ${Math.round(gaugeAwg)}`
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
  gap: 2px;
  justify-items: start;
}

.summary-row {
  position: relative;
  width: fit-content;
  padding: 1px 26px 1px 0;
  margin-bottom: 8px;
}

.summary-cable-stack {
  display: grid;
  gap: 0;
  justify-items: start;
}

.summary-cable-icon {
  position: relative;
  width: auto;
  line-height: 0;
}

.summary-cable-icon img {
  display: block;
  height: 100%;
  width: auto;
  object-fit: contain;
}

.summary-cable-gauge {
  position: absolute;
  left: 20px;
  top: 40%;
  transform: translate(-50%, -50%);
  font-size: 0.66rem;
  font-weight: 700;
  color: #f6f4ef;
  padding: 1px 5px;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.summary-row-count {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.68rem;
  font-weight: 700;
  color: #5a554f;
}
</style>
