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
        <button class="btn btn-ghost" type="button">Select</button>
        <button class="btn btn-ghost" type="button">Connect</button>
        <button class="btn btn-ghost" type="button">Group</button>
      </div>
      <CanvasStage />
    </section>

    <aside class="panel panel-right">
      <div class="panel-header">
        <h2>Inspector</h2>
        <p>Set properties for the selected item.</p>
      </div>
      <div class="panel-body">
        <div class="field">
          <label for="voltage">Voltage</label>
          <input id="voltage" type="number" placeholder="12" />
        </div>
        <div class="field">
          <label for="current">Current</label>
          <input id="current" type="number" placeholder="30" />
        </div>
        <div class="field">
          <label for="length">Cable Length (m)</label>
          <input id="length" type="number" placeholder="4" />
        </div>
      </div>
    </aside>

    <footer class="panel panel-bottom">
      <div class="panel-header">
        <h2>Validation</h2>
        <p>Issues and suggested fixes will appear here.</p>
      </div>
      <div class="panel-body">
        <div class="issue">
          <span class="issue-tag">Warning</span>
          Cable voltage drop exceeds target. Try 8 AWG or shorten the run.
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSchemaStore } from '~/stores/schema'

const schemaStore = useSchemaStore()

const components = computed(() => schemaStore.schema.components)
const cables = computed(() => schemaStore.schema.cables)
</script>
