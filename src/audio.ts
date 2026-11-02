/** Tiny Web Audio synth: no sample files, no network, no autoplay warnings. */
type Voice = 'place' | 'tap' | 'snap' | 'creak' | 'splash' | 'win' | 'lose' | 'whoosh'

class AudioManager {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  enabled = true

  private ensure(): AudioContext | null {
    if (!this.enabled) return null
    if (!this.context) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.context = new Ctor()
      this.master = this.context.createGain()
      this.master.gain.value = 0.28
      this.master.connect(this.context.destination)
    }
    if (this.context.state === 'suspended') void this.context.resume()
    return this.context
  }

  unlock(): void {
    // Called from a real user gesture, which is what browsers require.
    this.ensure()
  }

  setEnabled(value: boolean): void {
    this.enabled = value
    if (this.master) this.master.gain.value = value ? 0.28 : 0
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise
    const buffer = context.createBuffer(1, context.sampleRate * 0.6, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buffer
    return buffer
  }

  play(voice: Voice): void {
    const context = this.ensure()
    if (!context || !this.master) return
    const now = context.currentTime
    const gain = context.createGain()
    gain.connect(this.master)

    if (voice === 'place' || voice === 'tap') {
      const osc = context.createOscillator()
      osc.type = 'triangle'
      const base = voice === 'place' ? 320 : 520
      osc.frequency.setValueAtTime(base, now)
      osc.frequency.exponentialRampToValueAtTime(base * 0.6, now + 0.09)
      gain.gain.setValueAtTime(voice === 'place' ? 0.32 : 0.16, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      osc.connect(gain)
      osc.start(now)
      osc.stop(now + 0.13)
      return
    }

    if (voice === 'snap' || voice === 'creak') {
      const source = context.createBufferSource()
      source.buffer = this.noiseBuffer(context)
      const filter = context.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = voice === 'snap' ? 1400 : 380
      filter.Q.value = voice === 'snap' ? 2.4 : 6
      source.connect(filter)
      filter.connect(gain)
      gain.gain.setValueAtTime(voice === 'snap' ? 0.6 : 0.2, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + (voice === 'snap' ? 0.3 : 0.45))
      source.start(now)
      source.stop(now + 0.5)
      return
    }

    if (voice === 'splash' || voice === 'whoosh') {
      const source = context.createBufferSource()
      source.buffer = this.noiseBuffer(context)
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(voice === 'whoosh' ? 900 : 2200, now)
      filter.frequency.exponentialRampToValueAtTime(voice === 'whoosh' ? 300 : 400, now + 0.4)
      source.connect(filter)
      filter.connect(gain)
      gain.gain.setValueAtTime(voice === 'whoosh' ? 0.12 : 0.42, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
      source.start(now)
      source.stop(now + 0.5)
      return
    }

    // win / lose: four-note flourish, up or down.
    const notes =
      voice === 'win'
        ? [523.25, 659.25, 783.99, 1046.5]
        : [392, 349.23, 293.66, 220]
    notes.forEach((frequency, index) => {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = frequency
      const noteGain = context.createGain()
      const start = now + index * 0.12
      noteGain.gain.setValueAtTime(0, start)
      noteGain.gain.linearRampToValueAtTime(0.22, start + 0.02)
      noteGain.gain.exponentialRampToValueAtTime(0.001, start + 0.34)
      osc.connect(noteGain)
      noteGain.connect(this.master!)
      osc.start(start)
      osc.stop(start + 0.36)
    })
  }
}

export const audio = new AudioManager()
