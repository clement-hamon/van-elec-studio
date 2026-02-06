<template>
  <div class="workspace">
    <aside class="panel panel-left">
      <div class="panel-header">
        <h2>Library</h2>
        <p>Drag components into the canvas.</p>
      </div>
      <div class="panel-body">
        <button class="list-item" type="button">Battery</button>
        <button class="list-item" type="button">Inverter</button>
        <button class="list-item" type="button">Fuse</button>
        <button class="list-item" type="button">Cable</button>
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
      <CanvasStage :mode="mode" />
    </section>

    <aside class="panel panel-right">
      <div class="panel-header">
        <h2>Inspector</h2>
        <p>Set properties for the selected item.</p>
      </div>
      <div class="panel-body">
        <div class="field">
          <label for="voltage">Voltage</label>
          <input id="voltage" type="number" placeholder="12" >
        </div>
        <div class="field">
          <label for="current">Current</label>
          <input id="current" type="number" placeholder="30" >
        </div>
        <div class="field">
          <label for="length">Cable Length (m)</label>
          <input id="length" type="number" placeholder="4" >
        </div>
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

const schemaStore = useSchemaStore()

const issues = computed(() => schemaStore.issues)
const mode = ref<'select' | 'connect'>('select')
</script>
