<template>
  <details v-if="diff?.total" :class="$style.panel" open>
    <summary>{{ title }} · {{ diff.total }} 项差异</summary>
    <div class="scroll" :class="$style.rows">
      <table>
        <thead><tr><th>变化</th><th>歌单</th><th>之前</th><th>之后</th></tr></thead>
        <tbody><tr v-for="(change, index) in diff.changes" :key="index"><td>{{ labels[change.kind] }}</td><td>{{ change.scope }}</td><td>{{ change.before || '—' }}</td><td>{{ change.after || '—' }}</td></tr></tbody>
      </table>
    </div>
    <p v-if="diff.total > diff.changes.length">显示前 {{ diff.changes.length }} 项，共 {{ diff.total }} 项。</p>
  </details>
</template>
<script setup lang="ts">
import type { SyncDiff } from '@common/syncDiff'
defineProps<{ diff?: SyncDiff, title: string }>()
const labels: Record<string, string> = { added: '新增', removed: '删除', renamed: '重命名', changed: '修改' }
</script>
<style lang="less" module>
.panel { margin: 12px 0; font-size: 13px; line-height: 1.6; summary { cursor: pointer; } }
.rows { max-height: 240px; overflow: auto; table { width: 100%; border-collapse: collapse; } th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--color-primary-background-hover); overflow-wrap: anywhere; } }
</style>
