import { withRequestDeadline } from '@renderer/utils/requestContext'

interface SourceProgress {
  source: LX.OnlineSource
  status: 'loading' | 'success' | 'empty' | 'failed'
  elapsedMs: number
  count: number
}

export interface AggregateSearchState {
  status: 'loading' | 'success' | 'empty' | 'partial' | 'failed'
  failedSources: LX.OnlineSource[]
  pendingSources: LX.OnlineSource[]
  sources: SourceProgress[]
}

export interface AggregateSearchList {
  key: string | null
  list: unknown[]
  noItemLabel: string
  aggregate?: AggregateSearchState
}

export const createAggregateSearch = <T extends { list: unknown[] }>() => {
  interface Context {
    controller: AbortController
    key: string | null
    sources: LX.OnlineSource[]
    results: Map<LX.OnlineSource, T>
    failed: Set<LX.OnlineSource>
    pending: Set<LX.OnlineSource>
    progress: Map<LX.OnlineSource, SourceProgress>
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
      sources: context.sources.flatMap(source => context.progress.has(source) ? [{ ...context.progress.get(source)! }] : []),
    }
    context.update(results, pending && !context.retrying)
    if (failed && !list.list.length) list.noItemLabel = window.i18n.t(pending ? 'list__loading' : 'list__load_failed')
  }
  const run = async(list: AggregateSearchList, context: Context, sources: LX.OnlineSource[]) => {
    for (const source of sources) {
      context.pending.add(source)
      context.progress.set(source, { source, status: 'loading', elapsedMs: 0, count: 0 })
    }
    publish(list, context)
    await Promise.all(sources.map(async source => {
      const started = Date.now()
      const progress = context.progress.get(source)!
      try {
        const result = await withRequestDeadline(20000, async() => context.request(source), context.controller.signal)
        if (!result || !Array.isArray(result.list)) throw new Error(`Invalid search response: ${source}`)
        context.results.set(source, result)
        context.failed.delete(source)
        progress.status = result.list.length ? 'success' : 'empty'
        progress.count = result.list.length
      } catch {
        context.failed.add(source)
        progress.status = 'failed'
      } finally {
        progress.elapsedMs = Date.now() - started
        context.pending.delete(source)
        publish(list, context)
      }
    }))
  }
  return {
    async search(list: AggregateSearchList, sources: Array<LX.OnlineSource | 'all'>, request: Context['request'], update: Context['update']) {
      contexts.get(list)?.controller.abort()
      const context: Context = {
        controller: new AbortController(),
        key: list.key,
        sources: sources.filter((source): source is LX.OnlineSource => source !== 'all'),
        results: new Map(),
        failed: new Set(),
        pending: new Set(),
        progress: new Map(),
        request,
        update,
        retrying: false,
      }
      contexts.set(list, context)
      await run(list, context, context.sources)
    },
    async retry(list: AggregateSearchList, source?: LX.OnlineSource) {
      const context = contexts.get(list)
      if (!context || !current(list, context)) return
      if (!source && context.pending.size) return
      const sources = [...context.failed].filter(item => !context.pending.has(item) && (!source || source === item))
      if (!sources.length) return
      context.retrying = true
      await run(list, context, sources)
    },
    reset(list: AggregateSearchList) {
      contexts.get(list)?.controller.abort()
      contexts.delete(list)
      list.aggregate = undefined
    },
  }
}
