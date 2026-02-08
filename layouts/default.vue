<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"/>
        <span class="brand-name">Van Elec Studio</span>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-secondary" type="button" @click="onLoad">Load</button>
        <button class="btn btn-primary" type="button" @click="onSave">Save</button>
      </div>
    </header>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSchemaStore } from '~/stores/schema'

const schemaStore = useSchemaStore()

const onSave = () => {
  schemaStore.saveNow()
}

const onLoad = () => {
  schemaStore.loadFromStorage()
}

onMounted(() => {
  schemaStore.loadFromStorage()
})
</script>
