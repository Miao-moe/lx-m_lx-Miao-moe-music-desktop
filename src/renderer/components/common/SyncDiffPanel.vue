<template>
  <details v-if="diff?.total" :class="$style.panel" open>
    <summary>{{ title }} · {{ $t('sync_diff__items', { count: diff.total }) }}</summary>
    <div class="scroll" :class="$style.rows">
      <table>
        <thead><tr><th>{{ $t('sync_diff__kind') }}</th><th>{{ $t('sync_diff__playlist') }}</th><th>{{ $t('sync_diff__before') }}</th><th>{{ $t('sync_diff__after') }}</th></tr></thead>
        <tbody><tr v-for="(change, index) in diff.changes" :key="index"><td>{{ changeLabel(change.kind) }}</td><td>{{ scopeLabel(change) }}</td><td>{{ detailLabel(change, 'before') }}</td><td>{{ detailLabel(change, 'after') }}</td></tr></tbody>
      </table>
    </div>
    <p v-if="diff.total > diff.changes.length">{{ $t('sync_diff__truncated', { shown: diff.changes.length, total: diff.total }) }}</p>
  </details>
</template>
<script setup lang="ts">
import type { SyncDiff, SyncDifference } from '@common/syncDiff'
import { useI18n } from '@renderer/plugins/i18n'
defineProps<{ diff?: SyncDiff, title: string }>()
const t = useI18n()
const changeLabel = (kind: SyncDiff['changes'][number]['kind']) => ({ added: t('sync_diff__added'), removed: t('sync_diff__removed'), renamed: t('sync_diff__renamed'), changed: t('sync_diff__changed') })[kind]
const scopeLabel = (change: SyncDifference) => change.scopeKind === 'playlist' ? t('sync_diff__playlist') : change.scope
const detailLabel = (change: SyncDifference, side: 'before' | 'after') => {
  const value = change[side]
  if (!value) return '—'
  if (change.detailKind === 'order') return side === 'before' ? t('sync_diff__song_order') : t('sync_diff__order_changed')
  return value
}
</script>
<style lang="less" module>
.panel { margin: 12px 0; font-size: 13px; line-height: 1.6; summary { cursor: pointer; } }
.rows { max-height: 240px; overflow: auto; table { width: 100%; border-collapse: collapse; } th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--color-primary-background-hover); overflow-wrap: anywhere; } }
</style>
