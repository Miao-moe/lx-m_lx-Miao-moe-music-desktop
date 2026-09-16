<template>
  <section :class="$style.panel">
    <p>插件已从 Vue 源码编译并加载。</p>
    <button type="button" @click="count++">点击次数：{{ count }}</button>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<style module>
.panel { padding: 16px; color: var(--color-font); }
.panel button { margin-top: 12px; padding: 8px 12px; color: var(--color-primary); background: var(--color-primary-alpha-900); border: 0; border-radius: 6px; cursor: pointer; }
</style>
