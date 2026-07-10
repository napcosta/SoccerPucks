const STORAGE_KEY = 'soccer-pucks-audio';
const DEFAULT_VOLUME = 0.65;
const MAX_VOICES = 24;

const COOLDOWNS = Object.freeze({
  ui: 0.035,
  kick: 0.045,
  wall: 0.07,
  dash: 0.08,
  magnet_on: 0.12,
  magnet_capture: 0.08,
  magnet_off: 0.12,
  kickoff: 0.4,
  goal: 0.5,
  match_end: 0.5,
});

export class GameAudio {
  constructor() {
    const preferences = readPreferences();
    this.volume = preferences.volume;
    this.muted = preferences.muted;
    this.context = null;
    this.compressor = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.voices = new Set();
    this.magnetFields = new Map();
    this.lastPlayed = new Map();
    this.toggleButton = null;
    this.volumeInput = null;
    this.unlockTarget = null;
    this.unlockHandler = () => this.unlock();
  }

  installUnlock(target = document) {
    if (this.unlockTarget === target) return;
    if (this.unlockTarget) {
      this.unlockTarget.removeEventListener('pointerdown', this.unlockHandler, true);
      this.unlockTarget.removeEventListener('keydown', this.unlockHandler, true);
    }
    this.unlockTarget = target;
    target.addEventListener('pointerdown', this.unlockHandler, { capture: true, passive: true });
    target.addEventListener('keydown', this.unlockHandler, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.muted) this.unlock();
    });
  }

  bindControls(toggleButton, volumeInput) {
    this.toggleButton = toggleButton;
    this.volumeInput = volumeInput;

    toggleButton?.addEventListener('click', () => {
      if (this.muted || this.volume <= 0) {
        if (this.volume <= 0) this.setVolume(DEFAULT_VOLUME, false);
        this.setMuted(false);
        this.unlock();
      } else {
        this.setMuted(true);
      }
    });

    volumeInput?.addEventListener('input', () => {
      const nextVolume = Number(volumeInput.value) / 100;
      this.setVolume(nextVolume);
      if (nextVolume > 0 && this.muted) this.setMuted(false);
      if (nextVolume > 0) this.unlock();
    });

    this.updateControls();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      for (const id of this.magnetFields.keys()) this.stopMagnetField(id);
    }
    this.applyMasterGain();
    this.updateControls();
    this.savePreferences();
  }

  setVolume(volume, save = true) {
    this.volume = clamp(Number(volume) || 0, 0, 1);
    if (this.volume <= 0) {
      for (const id of this.magnetFields.keys()) this.stopMagnetField(id);
    }
    this.applyMasterGain();
    this.updateControls();
    if (save) this.savePreferences();
  }

  updateControls() {
    const effectivelyMuted = this.muted || this.volume <= 0;
    if (this.toggleButton) {
      const label = effectivelyMuted ? 'Turn sound on' : 'Mute sound';
      this.toggleButton.setAttribute('aria-label', label);
      this.toggleButton.setAttribute('aria-pressed', String(effectivelyMuted));
      this.toggleButton.title = label;
      this.toggleButton.classList.toggle('muted', effectivelyMuted);
      const icon = this.toggleButton.querySelector('[data-sound-icon]');
      if (icon) icon.textContent = effectivelyMuted ? '\u{1F507}' : '\u{1F50A}';
    }
    if (this.volumeInput) this.volumeInput.value = String(Math.round(this.volume * 100));
  }

  savePreferences() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch {
      // Storage can be unavailable in private browsing; sound still works for this session.
    }
  }

  unlock() {
    if (this.muted || this.volume <= 0) return Promise.resolve(false);
    const context = this.ensureContext();
    if (!context) return Promise.resolve(false);
    if (context.state === 'running') return Promise.resolve(true);
    return context.resume().then(() => context.state === 'running').catch(() => false);
  }

  play(kind, options = {}) {
    if (this.muted || this.volume <= 0) return;
    const context = this.ensureContext();
    if (!context) return;

    if (context.state !== 'running') {
      context.resume().then(() => {
        if (context.state === 'running') this.playNow(kind, options);
      }).catch(() => {});
      return;
    }

    this.playNow(kind, options);
  }

  playNow(kind, options) {
    const now = this.context.currentTime;
    const cooldown = COOLDOWNS[kind] ?? 0;
    const lastPlayed = this.lastPlayed.get(kind) ?? -Infinity;
    if (now - lastPlayed < cooldown) return;
    this.lastPlayed.set(kind, now);

    switch (kind) {
      case 'ui':
        this.playUi(options);
        break;
      case 'kick':
        this.playKick(options);
        break;
      case 'wall':
        this.playWall(options);
        break;
      case 'dash':
        this.playDash(options);
        break;
      case 'magnet_on':
        this.playMagnetOn(options);
        break;
      case 'magnet_capture':
        this.playMagnetCapture(options);
        break;
      case 'magnet_off':
        this.playMagnetOff(options);
        break;
      case 'kickoff':
        this.playKickoff(options);
        break;
      case 'goal':
        this.playGoal(options);
        break;
      case 'match_end':
        this.playMatchEnd(options);
        break;
    }
  }

  playUi({ pan = 0 } = {}) {
    this.tone({ frequency: 560, endFrequency: 420, type: 'triangle', duration: 0.05, gain: 0.035, pan });
  }

  playKick({ pan = 0 } = {}) {
    this.tone({ frequency: 155, endFrequency: 58, type: 'sine', duration: 0.13, gain: 0.19, pan });
    this.noise({ frequency: 760, filterType: 'lowpass', duration: 0.07, gain: 0.075, pan });
  }

  playWall({ strength = 0.5, pan = 0 } = {}) {
    const force = clamp(strength, 0, 1);
    // Force-field impact: a low energy bloom, a resonant shield sweep, and
    // irregular electrical crackles instead of a physical wall "thunk".
    this.tone({
      frequency: 118 + force * 74,
      endFrequency: 38,
      type: 'sine',
      duration: 0.22 + force * 0.12,
      attack: 0.012,
      gain: 0.08 + force * 0.12,
      pan,
    });
    this.tone({
      frequency: 720 + force * 740,
      endFrequency: 135 + force * 55,
      type: 'sine',
      duration: 0.15 + force * 0.09,
      attack: 0.003,
      gain: 0.035 + force * 0.055,
      pan,
    });
    this.noise({
      frequency: 2600 + force * 2100,
      endFrequency: 230 + force * 170,
      filterType: 'bandpass',
      q: 3.8 + force * 3,
      duration: 0.19 + force * 0.12,
      attack: 0.002,
      gain: 0.05 + force * 0.085,
      pan,
    });
    const crackles = force > 0.62 ? 4 : force > 0.25 ? 3 : 2;
    for (let i = 0; i < crackles; i++) {
      this.noise({
        frequency: 3300 + force * 2600 - i * 280,
        endFrequency: 900 + i * 170,
        filterType: 'highpass',
        q: 0.8,
        delay: 0.018 + i * (0.025 + force * 0.012),
        duration: 0.022 + force * 0.018,
        attack: 0.001,
        gain: 0.018 + force * 0.032,
        pan: clamp(pan + (i % 2 === 0 ? -0.08 : 0.08), -1, 1),
      });
    }
    this.noise({
      frequency: 1450 + force * 850,
      endFrequency: 520,
      filterType: 'bandpass',
      q: 2.4,
      delay: 0.075,
      duration: 0.17 + force * 0.08,
      gain: 0.022 + force * 0.035,
      pan: clamp(pan * 0.8, -1, 1),
    });
  }

  playDash({ pan = 0 } = {}) {
    this.noise({
      frequency: 1500,
      endFrequency: 420,
      filterType: 'bandpass',
      q: 0.7,
      duration: 0.28,
      gain: 0.11,
      pan,
    });
    this.tone({ frequency: 190, endFrequency: 72, type: 'sawtooth', duration: 0.18, gain: 0.045, pan });
  }

  playMagnetOn({ pan = 0 } = {}) {
    this.noise({
      frequency: 280,
      endFrequency: 1650,
      filterType: 'bandpass',
      q: 1.4,
      duration: 0.34,
      attack: 0.07,
      gain: 0.09,
      pan,
    });
    this.tone({
      frequency: 68,
      endFrequency: 112,
      type: 'sine',
      duration: 0.38,
      attack: 0.08,
      gain: 0.08,
      pan,
    });
  }

  playMagnetCapture({ pan = 0 } = {}) {
    // A soft two-part "yoink": the ball accelerates inward, then settles into the hold.
    this.noise({
      frequency: 1250,
      endFrequency: 330,
      filterType: 'bandpass',
      q: 1.8,
      duration: 0.18,
      gain: 0.075,
      pan,
    });
    this.tone({ frequency: 175, endFrequency: 410, type: 'sine', duration: 0.15, gain: 0.085, pan });
    this.tone({
      frequency: 510,
      endFrequency: 285,
      type: 'sine',
      delay: 0.075,
      duration: 0.19,
      attack: 0.018,
      gain: 0.065,
      pan,
    });
  }

  playMagnetOff({ pan = 0 } = {}) {
    this.noise({
      frequency: 1050,
      endFrequency: 190,
      filterType: 'bandpass',
      q: 1.1,
      duration: 0.26,
      gain: 0.055,
      pan,
    });
    this.tone({ frequency: 135, endFrequency: 54, type: 'sine', duration: 0.3, gain: 0.07, pan });
  }

  updateMagnetField(id, { active = false, pulling = false, captured = false, strength = 0, pan = 0 } = {}) {
    const key = String(id);
    if (!active || this.muted || this.volume <= 0) {
      this.stopMagnetField(key);
      return;
    }

    const context = this.ensureContext();
    if (!context || context.state !== 'running') return;

    let field = this.magnetFields.get(key);
    if (!field) {
      field = this.createMagnetField(key, pan);
      this.magnetFields.set(key, field);
    } else if (field.stopTimer) {
      clearTimeout(field.stopTimer);
      field.stopTimer = null;
    }

    const now = context.currentTime;
    const pull = pulling ? clamp(strength, 0, 1) : captured ? 0.42 : 0;
    const baseFrequency = 82 + pull * 92;
    const fieldVolume = captured ? 0.047 : 0.028 + pull * 0.085;

    smoothParam(field.carrierA.frequency, baseFrequency, now, 0.055);
    smoothParam(field.carrierB.frequency, baseFrequency * 1.505, now, 0.055);
    smoothParam(field.lfo.frequency, 2.6 + pull * 7.2, now, 0.08);
    smoothParam(field.pitchWobble.gain, 2.5 + pull * 13, now, 0.08);
    smoothParam(field.filterWobble.gain, 90 + pull * 620, now, 0.08);
    smoothParam(field.noiseFilter.frequency, 430 + pull * 1500, now, 0.055);
    smoothParam(field.noiseFilter.Q, 1.1 + pull * 4.8, now, 0.07);
    smoothParam(field.noiseGain.gain, captured ? 0.035 : 0.018 + pull * 0.15, now, 0.06);
    smoothParam(field.delay.delayTime, 0.038 - pull * 0.016, now, 0.09);
    smoothParam(field.fieldGain.gain, fieldVolume, now, 0.045);
    if (field.panner) smoothParam(field.panner.pan, clamp(pan, -1, 1), now, 0.07);
  }

  createMagnetField(id, pan) {
    const context = this.context;
    const now = context.currentTime;
    const carrierA = context.createOscillator();
    const carrierB = context.createOscillator();
    const carrierAGain = context.createGain();
    const carrierBGain = context.createGain();
    const noiseSource = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const mix = context.createGain();
    const dryGain = context.createGain();
    const delay = context.createDelay(0.12);
    const feedbackGain = context.createGain();
    const wetGain = context.createGain();
    const fieldGain = context.createGain();
    const lfo = context.createOscillator();
    const pitchWobble = context.createGain();
    const filterWobble = context.createGain();
    const panner =
      typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;

    carrierA.type = 'sine';
    carrierB.type = 'sine';
    carrierA.frequency.value = 82;
    carrierB.frequency.value = 123.4;
    carrierAGain.gain.value = 0.2;
    carrierBGain.gain.value = 0.075;

    noiseSource.buffer = this.getNoiseBuffer();
    noiseSource.loop = true;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 430;
    noiseFilter.Q.value = 1.1;
    noiseGain.gain.value = 0.018;

    dryGain.gain.value = 0.86;
    delay.delayTime.value = 0.038;
    feedbackGain.gain.value = 0.16;
    wetGain.gain.value = 0.3;
    fieldGain.gain.setValueAtTime(0.0001, now);
    fieldGain.gain.linearRampToValueAtTime(0.028, now + 0.12);

    lfo.type = 'sine';
    lfo.frequency.value = 2.6;
    pitchWobble.gain.value = 2.5;
    filterWobble.gain.value = 90;
    lfo.connect(pitchWobble);
    pitchWobble.connect(carrierA.frequency);
    pitchWobble.connect(carrierB.frequency);
    lfo.connect(filterWobble);
    filterWobble.connect(noiseFilter.frequency);

    carrierA.connect(carrierAGain);
    carrierB.connect(carrierBGain);
    carrierAGain.connect(mix);
    carrierBGain.connect(mix);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(mix);
    mix.connect(dryGain);
    dryGain.connect(fieldGain);
    mix.connect(delay);
    delay.connect(feedbackGain);
    feedbackGain.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(fieldGain);

    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      fieldGain.connect(panner);
      panner.connect(this.compressor);
    } else {
      fieldGain.connect(this.compressor);
    }

    carrierA.start(now);
    carrierB.start(now);
    noiseSource.start(now);
    lfo.start(now);

    return {
      id,
      carrierA,
      carrierB,
      noiseSource,
      lfo,
      noiseFilter,
      noiseGain,
      delay,
      fieldGain,
      pitchWobble,
      filterWobble,
      panner,
      sources: [carrierA, carrierB, noiseSource, lfo],
      nodes: [
        carrierA,
        carrierB,
        carrierAGain,
        carrierBGain,
        noiseSource,
        noiseFilter,
        noiseGain,
        mix,
        dryGain,
        delay,
        feedbackGain,
        wetGain,
        fieldGain,
        lfo,
        pitchWobble,
        filterWobble,
        ...(panner ? [panner] : []),
      ],
      stopTimer: null,
    };
  }

  stopMagnetField(id, immediate = false) {
    const key = String(id);
    const field = this.magnetFields.get(key);
    if (!field) return;
    if (immediate) {
      this.cleanupMagnetField(field);
      return;
    }
    if (field.stopTimer) return;

    const now = this.context.currentTime;
    field.fieldGain.gain.cancelScheduledValues(now);
    field.fieldGain.gain.setTargetAtTime(0.0001, now, 0.04);
    field.stopTimer = setTimeout(() => this.cleanupMagnetField(field), 220);
  }

  cleanupMagnetField(field) {
    if (this.magnetFields.get(field.id) !== field) return;
    if (field.stopTimer) clearTimeout(field.stopTimer);
    this.magnetFields.delete(field.id);
    for (const source of field.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have stopped while the field was fading out.
      }
    }
    for (const node of field.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  playKickoff({ delay = 0 } = {}) {
    this.tone({
      frequency: 1180,
      endFrequency: 1580,
      type: 'sine',
      delay,
      duration: 0.32,
      attack: 0.018,
      gain: 0.13,
    });
    this.tone({
      frequency: 2360,
      endFrequency: 3160,
      type: 'sine',
      delay,
      duration: 0.32,
      attack: 0.018,
      gain: 0.035,
    });
  }

  playGoal({ positive = true, delay = 0 } = {}) {
    const notes = positive ? [392, 523.25, 659.25, 783.99] : [349.23, 311.13, 261.63];
    this.noise({
      frequency: 1050,
      filterType: 'lowpass',
      delay,
      duration: 0.72,
      attack: 0.035,
      gain: positive ? 0.1 : 0.065,
    });
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency * 1.015,
        type: index % 2 ? 'triangle' : 'sine',
        delay: delay + index * 0.095,
        duration: 0.34,
        gain: positive ? 0.085 : 0.065,
      });
    });
  }

  playMatchEnd({ outcome = 'draw', delay = 0 } = {}) {
    const notes =
      outcome === 'victory'
        ? [261.63, 329.63, 392, 523.25]
        : outcome === 'defeat'
          ? [349.23, 293.66, 246.94, 196]
          : [293.66, 349.23, 293.66];
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency,
        type: outcome === 'defeat' ? 'triangle' : 'sine',
        delay: delay + index * 0.13,
        duration: index === notes.length - 1 ? 0.55 : 0.24,
        gain: 0.075,
      });
    });
  }

  tone({
    frequency,
    endFrequency = frequency,
    type = 'sine',
    delay = 0,
    duration = 0.1,
    attack = 0.006,
    gain = 0.1,
    pan = 0,
  }) {
    const context = this.context;
    const start = context.currentTime + Math.max(0, delay);
    const end = start + duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(gain, start + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    const outputNodes = this.connectOutput(envelope, pan);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    this.trackVoice(oscillator, [oscillator, envelope, ...outputNodes]);
  }

  noise({
    frequency = 1000,
    endFrequency = frequency,
    filterType = 'lowpass',
    q = 0.8,
    delay = 0,
    duration = 0.1,
    attack = 0.004,
    gain = 0.08,
    pan = 0,
  }) {
    const context = this.context;
    const start = context.currentTime + Math.max(0, delay);
    const end = start + duration;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.getNoiseBuffer();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, start);
    filter.frequency.setValueAtTime(Math.max(20, frequency), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(gain, start + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter);
    filter.connect(envelope);
    const outputNodes = this.connectOutput(envelope, pan);
    source.start(start, Math.random() * 0.15, duration + 0.02);
    source.stop(end + 0.02);
    this.trackVoice(source, [source, filter, envelope, ...outputNodes]);
  }

  connectOutput(node, pan) {
    if (typeof this.context.createStereoPanner === 'function') {
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node.connect(panner);
      panner.connect(this.compressor);
      return [panner];
    }
    node.connect(this.compressor);
    return [];
  }

  trackVoice(source, nodes) {
    const voice = { source, nodes };
    this.voices.add(voice);
    while (this.voices.size > MAX_VOICES) {
      const oldest = this.voices.values().next().value;
      this.stopVoice(oldest);
    }
    source.addEventListener('ended', () => this.cleanupVoice(voice), { once: true });
  }

  stopVoice(voice) {
    try {
      voice.source.stop();
    } catch {
      // A voice may already have reached its scheduled stop time.
    }
    this.cleanupVoice(voice);
  }

  cleanupVoice(voice) {
    if (!this.voices.delete(voice)) return;
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.ceil(this.context.sampleRate * 1.0);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  ensureContext() {
    if (this.context) return this.context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    const context = new AudioContextClass();
    const compressor = context.createDynamicsCompressor();
    const masterGain = context.createGain();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    compressor.connect(masterGain);
    masterGain.connect(context.destination);

    this.context = context;
    this.compressor = compressor;
    this.masterGain = masterGain;
    this.applyMasterGain(true);
    return context;
  }

  applyMasterGain(immediate = false) {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    const target = this.muted ? 0 : this.volume;
    this.masterGain.gain.cancelScheduledValues(now);
    if (immediate) {
      this.masterGain.gain.setValueAtTime(target, now);
    } else {
      this.masterGain.gain.setTargetAtTime(target, now, 0.015);
    }
  }
}

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      muted: Boolean(saved?.muted),
      volume: Number.isFinite(saved?.volume) ? clamp(saved.volume, 0, 1) : DEFAULT_VOLUME,
    };
  } catch {
    return { muted: false, volume: DEFAULT_VOLUME };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothParam(param, value, now, timeConstant) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

export const gameAudio = new GameAudio();
