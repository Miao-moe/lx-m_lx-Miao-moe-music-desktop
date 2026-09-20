import { appSetting } from '@renderer/store/setting'

export interface AggregateSearchState {
  status: 'loading' | 'success' | 'empty' | 'partial' | 'failed'
  failedSources: LX.OnlineSource[]
  pendingSources: LX.OnlineSource[]
}

export interface AggregateSearchList {
  key: string | null
  list: unknown[]
  noItemLabel: string
  aggregate?: AggregateSearchState
}

export const createAggregateSearch = <T extends { list: unknown[] }>() => {
  interface Context {
    key: string | null
    sources: LX.OnlineSource[]
    results: Map<LX.OnlineSource, T>
    failed: Set<LX.OnlineSource>
    pending: Set<LX.OnlineSource>
    request: (source: LX.OnlineSource) => Promise<T> | undefined
    update: (results: T[], pending: boolean) => void
    retrying: boolean
  }
  const contexts = new WeakMap<AggregateSearchList, Context>()
  const current = (list: AggregateSearchList, context: Context) => contexts.get(list) === context && list.key === context.key
  const publish = (list: AggregateSearchList, context: Context) => {
    if (!current(list, context)) return
    const results = context.sources.flatMap(source => context.results.has(source) ? [context.results.get(source)!] : [])
    const pending = context.pending.size > 0
    const failed = context.failed.size
    list.aggregate = {
      status: pending ? 'loading' : failed && failed === context.sources.length ? 'failed' : failed ? 'partial' : results.some(result => result.list.length) ? 'success' : 'empty',
      failedSources: context.sources.filter(source => context.failed.has(source)),
      pendingSources: [...context.pending],
    }
    if (pending && !context.retrying && appSetting['list.loadingMode'] !== 'immediate') return
    context.update(results, pending && !context.retrying)
    if (failed && !list.list.length) list.noItemLabel = window.i18n.t(pending ? 'list__loading' : 'list__load_failed')
  }
  const run = async(list: AggregateSearchList, context: Context, sources: LX.OnlineSource[]) => {
    for (const source of sources) context.pending.add(source)
    publish(list, context)
    await Promise.all(sources.map(async source => {
      try {
        const result = await context.request(source)
        if (!result || !Array.isArray(result.list)) throw new Error(`Invalid search response: ${source}`)
        context.results.set(source, result)
        context.failed.delete(source)
      } catch {
        context.failed.add(source)
      } finally {
        context.pending.delete(source)
        publish(list, context)
      }
    }))
  }
  return {
    async search(list: AggregateSearchList, sources: Array<LX.OnlineSource | 'all'>, request: Context['request'], update: Context['update']) {
      const context: Context = {
        key: list.key,
        sources: sources.filter((source): source is LX.OnlineSource => source !== 'all'),
        results: new Map(),
        failed: new Set(),
        pending: new Set(),
        request,
        update,
        retrying: false,
      }
      contexts.set(list, context)
      await run(list, context, context.sources)
    },
    async retry(list: AggregateSearchList) {
      const context = contexts.get(list)
      if (!context || !current(list, context) || context.pending.size) return
      const sources = [...context.failed]
      if (!sources.length) return
      context.retrying = true
      await run(list, context, sources)
    },
    reset(list: AggregateSearchList) {
      contexts.delete(list)
      list.aggregate = undefined
    },
  }
}
