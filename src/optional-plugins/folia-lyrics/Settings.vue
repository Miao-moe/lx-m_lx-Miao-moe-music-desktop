<template>
  <div data-plugin-settings="folia-lyrics" :class="$style.settings">
    <label :class="$style.enable"><input type="checkbox" data-folia-enabled :checked="preferences.enabled" @change="toggle"> {{ labels.enable }}</label>
    <p>{{ labels.hint }}</p>
    <Stage preview :class="$style.preview" />
  </div>
</template>
<script setup lang="ts">
import Stage from './Stage.vue'
import { preferences, savePreferences } from './preferences'
import { useLabels } from './labels'
const labels = useLabels()
const toggle = (event: Event) => { savePreferences({ enabled: (event.target as HTMLInputElement).checked }) }
</script>
<style lang="less" module>
.settings { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 1.6; }
.enable { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.preview { height: 340px; }
</style>
