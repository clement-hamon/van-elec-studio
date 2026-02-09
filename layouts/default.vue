<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"/>
        <span class="brand-name">Van Elec Studio</span>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-ghost" type="button" :disabled="!canUndo" @click="onUndo">
          Undo
        </button>
        <button class="btn btn-ghost" type="button" :disabled="isEmpty" @click="onReset">
          Reset
        </button>
      </div>
    </header>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useSchemaStore } from '~/stores/schema'

const schemaStore = useSchemaStore()
const isEmpty = computed(
  () => schemaStore.schema.components.length === 0 && schemaStore.schema.cables.length === 0,
)
const canUndo = computed(() => schemaStore.historyDepth > 0)

const onReset = () => {
  if (
    !window.confirm('Clear the canvas? This will remove all components, cables, and groups.')
  ) {
    return
  }
  schemaStore.clearSchema()
}

const onUndo = () => {
  schemaStore.undo()
}

onMounted(() => {
  schemaStore.loadFromStorage()
})
</script>
