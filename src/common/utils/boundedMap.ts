export class BoundedMap<K, V> extends Map<K, V> {
  private readonly touched = new Map<K, true>()
  private readonly weights = new Map<K, number>()
  private totalWeight = 0
  constructor(private readonly capacity: number, private readonly maxWeight: number, private readonly weight: (value: V) => number, private readonly pinned: (key: K) => boolean = () => false) { super() }
  get(key: K) {
    const value = super.get(key)
    if (super.has(key)) { this.touched.delete(key); this.touched.set(key, true) }
    return value
  }

  set(key: K, value: V) {
    super.set(key, value)
    this.totalWeight += this.weight(value) - (this.weights.get(key) ?? 0)
    this.weights.set(key, this.weight(value))
    this.touched.delete(key); this.touched.set(key, true)
    this.prune(false)
    return this
  }

  delete(key: K) { this.touched.delete(key); this.totalWeight -= this.weights.get(key) ?? 0; this.weights.delete(key); return super.delete(key) }
  clear() { this.touched.clear(); this.weights.clear(); this.totalWeight = 0; super.clear() }
  // Mutable cached arrays call prune explicitly after changing their contents.
  prune(reweigh = true) {
    if (reweigh) {
      this.totalWeight = 0
      for (const [key, value] of this) { const weight = this.weight(value); this.weights.set(key, weight); this.totalWeight += weight }
    }
    for (const key of this.touched.keys()) {
      if (this.size <= this.capacity && this.totalWeight <= this.maxWeight) break
      if (this.pinned(key)) continue
      this.delete(key)
    }
  }
}
