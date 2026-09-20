/* global AudioWorkletProcessor, registerProcessor, sampleRate */

// Per-track level matching, before the user's volume and crossfade envelopes.
// A gated RMS estimate deliberately ignores silence and very quiet passages.
class VolumeNormalizer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]
  }

  constructor() {
    super()
    this.delay = Math.ceil(sampleRate * 0.005)
    this.capacity = this.delay + 2
    this.buffers = []
    this.peaks = new Float64Array(this.capacity)
    this.peakFrames = new Float64Array(this.capacity)
    this.head = 0
    this.tail = 0
    this.frame = 0
    this.limiter = 1
    this.enabledMix = 0
    this.generation = 0
    this.reset()
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') {
        this.generation = data.generation
        this.reset(data.state)
      } else if (data.type === 'dispose') this.disposed = true
    }
  }

  reset(state) {
    this.energy = Number.isFinite(state?.energy) && state.energy > 0 ? state.energy : 0
    this.activeTime = this.energy ? 3 : 0
    this.gainDb = Number.isFinite(state?.gainDb) ? Math.max(-18, Math.min(6, state.gainDb)) : 0
    this.windowEnergy = 0
    this.windowFrames = 0
    this.reportFrames = 0
    this.silentFrames = 0
    this.head = this.tail = this.frame = 0
    this.limiter = 1
    for (const buffer of this.buffers) buffer.fill(0)
  }

  process(inputs, outputs, parameters) {
    if (this.disposed) return false
    const input = inputs[0]
    const output = outputs[0]
    if (!output.length) return true
    const frames = output[0].length
    const enabled = parameters.enabled[0] >= 0.5
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.capacity))
    let sum = 0
    for (let channel = 0; channel < input.length; channel++) {
      for (let i = 0; i < frames; i++) sum += input[channel][i] ** 2
    }
    this.silentFrames = sum === 0 ? this.silentFrames + frames : 0
    if (this.silentFrames > this.delay + frames) {
      for (const buffer of this.buffers) buffer.fill(0)
      this.head = this.tail = this.frame = 0
      this.windowEnergy = this.windowFrames = 0
      for (const channel of output) channel.fill(0)
      return true
    }
    this.windowEnergy += sum / Math.max(1, input.length)
    this.windowFrames += frames
    if (this.windowFrames >= sampleRate * 0.1) {
      const energy = this.windowEnergy / this.windowFrames
      const elapsed = this.windowFrames / sampleRate
      if (enabled && energy > 10 ** (-55 / 10) && (!this.energy || energy > this.energy * 0.1)) {
        const weight = this.activeTime < 3 ? elapsed / (this.activeTime + elapsed) : 1 - Math.exp(-elapsed / 8)
        this.energy += (energy - this.energy) * weight
        this.activeTime += elapsed
      }
      this.windowEnergy = this.windowFrames = 0
    }
    const desiredDb = this.activeTime >= 0.3 ? Math.max(-18, Math.min(6, -18 - 10 * Math.log10(this.energy))) : 0
    const startDb = this.gainDb
    const speed = desiredDb < startDb ? 0.3 : 1.5
    if (enabled) this.gainDb += (desiredDb - this.gainDb) * (1 - Math.exp(-frames / (sampleRate * speed)))
    const startGain = 10 ** (startDb / 20)
    const endGain = 10 ** (this.gainDb / 20)
    const release = 1 - Math.exp(-1 / (sampleRate * 0.08))
    const mixStep = 1 / (sampleRate * 0.05)
    for (let i = 0; i < frames; i++) {
      // Enabling/disabling is blended instead of inserting a discontinuous gain step.
      this.enabledMix = Math.max(0, Math.min(1, this.enabledMix + (enabled ? mixStep : -mixStep)))
      const gain = 1 + (startGain + (endGain - startGain) * (i + 1) / frames - 1) * this.enabledMix
      let peak = 0
      const write = this.frame % this.capacity
      for (let channel = 0; channel < output.length; channel++) {
        const value = (input[channel]?.[i] ?? 0) * gain
        this.buffers[channel][write] = value
        peak = Math.max(peak, Math.abs(value))
      }
      // Linked-channel, 5 ms lookahead peak protection; preserve stereo balance.
      while (this.head < this.tail && this.peakFrames[this.head % this.capacity] < this.frame - this.delay) this.head++
      while (this.tail > this.head && this.peaks[(this.tail - 1) % this.capacity] <= peak) this.tail--
      this.peaks[this.tail % this.capacity] = peak
      this.peakFrames[this.tail % this.capacity] = this.frame
      this.tail++
      const maximum = this.peaks[this.head % this.capacity]
      const limit = this.enabledMix > 0 ? Math.min(1, 0.98 / Math.max(maximum, 0.000001)) : 1
      this.limiter = limit < this.limiter ? limit : this.limiter + (limit - this.limiter) * release
      const read = (this.frame - this.delay + this.capacity) % this.capacity
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][i] = this.frame < this.delay ? 0 : this.buffers[channel][read] * this.limiter
      }
      this.frame++
    }
    this.reportFrames += frames
    if (enabled && this.reportFrames >= sampleRate * 0.1) {
      this.reportFrames = 0
      this.port.postMessage({ generation: this.generation, energy: this.energy, gainDb: this.gainDb })
    }
    return true
  }
}

registerProcessor('lx-volume-normalizer', VolumeNormalizer)
