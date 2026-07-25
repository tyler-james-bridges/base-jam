import {
  PULSE_STEP_SECONDS,
  type PulseChart,
  type PulseJudgement,
  type PulseLayer,
  type PulseState,
} from "@/game/pulse";

let sharedAudioContext: AudioContext | null = null;
const MASTER_GAIN = 0.42;

export function armPulseAudio(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") {
    return null;
  }
  try {
    sharedAudioContext ??= new AudioContext({ latencyHint: "interactive" });
    void sharedAudioContext.resume();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

const MINOR_SCALE = [0, 3, 5, 7, 10] as const;

function frequencyForMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function hexByte(hash: string, index: number): number {
  const offset = 2 + (index % 32) * 2;
  const value = Number.parseInt(hash.slice(offset, offset + 2), 16);
  return Number.isFinite(value) ? value : 0;
}

export class PulseAudioEngine {
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly noiseBuffer: AudioBuffer | null;
  private readonly chart: PulseChart;
  private readonly keyIndex: number;
  private readonly getState: () => PulseState;
  private nextStep = 0;
  private startAt = 0;
  private startAtPerformance = 0;
  private muted = false;
  private stopped = false;

  constructor(
    context: AudioContext | null,
    chart: PulseChart,
    getState: () => PulseState,
  ) {
    this.context = context;
    this.chart = chart;
    this.keyIndex = chart.keyIndex;
    this.getState = getState;

    if (context) {
      this.master = context.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(context.destination);
      this.noiseBuffer = context.createBuffer(
        1,
        context.sampleRate,
        context.sampleRate,
      );
      const channel = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.random() * 2 - 1;
      }
    } else {
      this.master = null;
      this.noiseBuffer = null;
    }
  }

  start(leadInSeconds = 0.9) {
    const now = this.context?.currentTime ?? 0;
    this.startAt = now + leadInSeconds;
    this.startAtPerformance = performance.now() + leadInSeconds * 1_000;
    this.nextStep = 0;
    this.stopped = false;
    void this.context?.resume();
  }

  songTime(): number {
    if (this.context?.state === "running") {
      return this.context.currentTime - this.startAt;
    }
    return (performance.now() - this.startAtPerformance) / 1_000;
  }

  update() {
    if (!this.context || !this.master || this.stopped || this.muted) return;
    const scheduleThrough = this.context.currentTime + 0.14;
    while (
      this.startAt + this.nextStep * PULSE_STEP_SECONDS <
      scheduleThrough
    ) {
      const when = this.startAt + this.nextStep * PULSE_STEP_SECONDS;
      if (when >= this.context.currentTime - 0.02) {
        this.scheduleStep(this.nextStep, when, this.getState());
      }
      this.nextStep += 1;
    }
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(
        this.muted ? 0.0001 : MASTER_GAIN,
        this.context.currentTime,
        0.025,
      );
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  hit(lane: PulseLayer, column: number, judgement: PulseJudgement) {
    if (!this.context || !this.master || this.muted) return;
    void this.context.resume();
    const when = this.context.currentTime;
    const scaleNote = MINOR_SCALE[(lane + column) % MINOR_SCALE.length];
    const octave = judgement === "perfect" ? 72 : 60;
    this.tone(
      frequencyForMidi(octave + this.keyIndex + scaleNote),
      when,
      judgement === "perfect" ? 0.12 : 0.08,
      lane === 1 ? "square" : "triangle",
      judgement === "perfect" ? 0.11 : 0.07,
    );
  }

  miss(kind: "wrong" | "late" = "late") {
    if (!this.context || !this.master || this.muted) return;
    void this.context.resume();
    const when = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(when);
    gain.setValueAtTime(Math.max(0.0001, gain.value), when);
    gain.exponentialRampToValueAtTime(
      kind === "wrong" ? 0.08 : 0.13,
      when + 0.025,
    );
    gain.setTargetAtTime(MASTER_GAIN, when + 0.12, 0.1);
    this.negative(when, kind === "wrong");
  }

  capture(lane: PulseLayer) {
    if (!this.context || !this.master || this.muted) return;
    const when = this.context.currentTime;
    const root = 60 + this.keyIndex;
    [0, 3, 7].forEach((interval, index) => {
      this.tone(
        frequencyForMidi(root + interval + lane),
        when + index * 0.035,
        0.32,
        index === 0 ? "sine" : "triangle",
        0.09,
      );
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(
        0.0001,
        this.context.currentTime,
        0.035,
      );
    }
  }

  private scheduleStep(step: number, when: number, state: PulseState) {
    const stepInBar = step % 16;
    const bar = Math.floor(step / 16);
    const profile = this.profileForBar(bar);
    const active = (lane: PulseLayer) =>
      state.capturedUntilBar[lane] > bar;

    if (stepInBar === 0) {
      this.kick(when, active(0) ? 0.13 + profile.energy * 0.04 : 0.055);
    } else if (stepInBar % 4 === 0 && !active(0)) {
      this.hat(when, 0.012 + profile.energy * 0.008);
    }

    if (active(0)) {
      if (
        stepInBar === 8 ||
        (profile.energy > 0.76 && stepInBar === profile.accentStep)
      ) {
        this.kick(when, 0.1 + profile.energy * 0.05);
      }
      if (stepInBar === 4 || stepInBar === 12) {
        this.snare(when, 0.072 + profile.energy * 0.032);
      }
      if (
        stepInBar % 2 === 0 ||
        (profile.energy > 0.72 && stepInBar % 4 === 3)
      ) {
        this.hat(when, 0.022 + profile.energy * 0.018);
      }
    }

    const bassSteps =
      profile.energy > 0.68 ? [0, 3, 6, 8, 11, 14] : [0, 3, 8, 11];
    if (active(1) && bassSteps.includes(stepInBar)) {
      const pattern = [0, 0, 3, 4, 0, 7, 3, 5];
      const note =
        pattern[
          (profile.patternOffset + bar * 4 + Math.floor(stepInBar / 3)) %
            pattern.length
        ];
      this.bass(when, note, profile.brightness);
    }

    const synthSteps =
      profile.energy > 0.58
        ? [0, 2, 5, 7, 10, 13]
        : [0, 5, 10, 13];
    if (active(2) && synthSteps.includes(stepInBar)) {
      const pattern = [0, 3, 7, 10, 7, 3];
      const note =
        pattern[
          (profile.patternOffset + bar + stepInBar) % pattern.length
        ];
      this.synth(
        when,
        note,
        (stepInBar % 4 === 0 ? 0.06 : 0.035) +
          profile.energy * 0.018,
        profile.brightness,
      );
    }

    if (active(3)) {
      if (stepInBar === 0) {
        this.fxSweep(
          when,
          profile.rising,
          profile.brightness,
          profile.energy,
        );
      }
      if (stepInBar === 6 || stepInBar === 14) {
        this.noise(
          when,
          0.055 + profile.energy * 0.035,
          0.018 + profile.energy * 0.018,
          profile.brightness,
        );
      }
    }
  }

  private profileForBar(bar: number) {
    const event =
      this.chart.events[
        Math.min(Math.max(0, bar), Math.max(0, this.chart.events.length - 1))
      ];
    const gas = Math.min(1, Math.max(0, event?.gasRatio ?? 0));
    const calldata = Math.min(
      1,
      Math.log2(1 + Math.max(0, event?.calldataBytes ?? 0)) / 17,
    );
    const hashValue = event ? hexByte(event.blockHash, bar + 11) : 0;
    return {
      accentStep: 5 + (hashValue % 7),
      brightness: 650 + calldata * 4_900,
      energy: Math.min(0.94, 0.24 + gas * 0.54 + (hashValue / 255) * 0.16),
      patternOffset: hashValue % 6,
      rising: hashValue % 2 === 0,
    };
  }

  private tone(
    frequency: number,
    when: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    filterFrequency?: number,
  ) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency ?? 7_000, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  private kick(when: number, volume: number) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(145, when);
    oscillator.frequency.exponentialRampToValueAtTime(46, when + 0.13);
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.2);
  }

  private snare(when: number, volume: number) {
    this.noise(when, 0.12, volume, 1_900);
    this.tone(178, when, 0.09, "triangle", volume * 0.45, 1_200);
  }

  private hat(when: number, volume: number) {
    this.noise(when, 0.035, volume, 7_000);
  }

  private noise(
    when: number,
    duration: number,
    volume: number,
    frequency: number,
  ) {
    if (!this.context || !this.master || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = frequency > 4_000 ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(frequency, when);
    filter.Q.setValueAtTime(0.8, when);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(when);
    source.stop(when + duration + 0.01);
  }

  private bass(
    when: number,
    scaleOffset: number,
    brightness: number,
  ) {
    const midi = 36 + this.keyIndex + scaleOffset;
    this.tone(
      frequencyForMidi(midi),
      when,
      0.2,
      "sawtooth",
      0.085,
      Math.min(760, 310 + brightness * 0.085),
    );
  }

  private synth(
    when: number,
    scaleOffset: number,
    volume: number,
    brightness: number,
  ) {
    const midi = 60 + this.keyIndex + scaleOffset;
    this.tone(
      frequencyForMidi(midi),
      when,
      0.15,
      "triangle",
      volume,
      Math.min(5_800, 1_500 + brightness * 0.72),
    );
    this.tone(
      frequencyForMidi(midi + 12),
      when + 0.008,
      0.1,
      "sine",
      volume * 0.34,
      Math.min(7_200, 2_200 + brightness),
    );
  }

  private fxSweep(
    when: number,
    rising: boolean,
    brightness: number,
    energy: number,
  ) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(rising ? 82 : 164, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      rising ? 328 : 82,
      when + 0.36,
    );
    filter.type = "bandpass";
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(Math.max(420, brightness * 0.34), when);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(900, brightness),
      when + 0.36,
    );
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
      0.025 + energy * 0.025,
      when + 0.03,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.42);
  }

  private negative(when: number, wrong: boolean) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(wrong ? 128 : 112, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      wrong ? 76 : 64,
      when + 0.11,
    );
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520, when);
    gain.gain.setValueAtTime(0.035, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.15);
  }
}
