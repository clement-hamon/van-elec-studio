<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-name">Van Elec Studio</span>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-secondary" type="button">Load</button>
        <button class="btn btn-primary" type="button">Save</button>
      </div>
    </header>
    <slot />
  </div>
</template>
