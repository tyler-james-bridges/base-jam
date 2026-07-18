import {
  RHYTHM_STEP_SECONDS,
  type RhythmJudgement,
  type RhythmLane,
  type RhythmState,
} from "@/game/rhythm";

let sharedAudioContext: AudioContext | null = null;

export function armRhythmAudio(): AudioContext | null {
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

export class RhythmAudioEngine {
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly noiseBuffer: AudioBuffer | null;
  private readonly keyIndex: number;
  private readonly getState: () => RhythmState;
  private nextStep = 0;
  private startAt = 0;
  private startAtPerformance = 0;
  private muted = false;
  private stopped = false;

  constructor(
    context: AudioContext | null,
    keyIndex: number,
    getState: () => RhythmState,
  ) {
    this.context = context;
    this.keyIndex = keyIndex;
    this.getState = getState;

    if (context) {
      this.master = context.createGain();
      this.master.gain.value = 0.42;
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
      this.startAt + this.nextStep * RHYTHM_STEP_SECONDS <
      scheduleThrough
    ) {
      const when = this.startAt + this.nextStep * RHYTHM_STEP_SECONDS;
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
        this.muted ? 0.0001 : 0.42,
        this.context.currentTime,
        0.025,
      );
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  hit(lane: RhythmLane, column: number, judgement: RhythmJudgement) {
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

  miss() {
    if (!this.context || !this.master || this.muted) return;
    this.noise(this.context.currentTime, 0.045, 0.035, 700);
  }

  capture(lane: RhythmLane) {
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

  private scheduleStep(step: number, when: number, state: RhythmState) {
    const stepInBar = step % 16;
    const bar = Math.floor(step / 16);
    const active = (lane: RhythmLane) =>
      state.capturedUntilBar[lane] > bar;

    if (stepInBar === 0) {
      this.kick(when, active(0) ? 0.16 : 0.07);
    } else if (stepInBar % 4 === 0 && !active(0)) {
      this.hat(when, 0.018);
    }

    if (active(0)) {
      if (stepInBar === 8) this.kick(when, 0.14);
      if (stepInBar === 4 || stepInBar === 12) this.snare(when, 0.095);
      if (stepInBar % 2 === 0) this.hat(when, 0.035);
    }

    if (active(1) && [0, 3, 8, 11].includes(stepInBar)) {
      const pattern = [0, 0, 3, 4, 0, 7, 3, 5];
      const note = pattern[(bar * 4 + Math.floor(stepInBar / 3)) % pattern.length];
      this.bass(when, note);
    }

    if (active(2) && [0, 2, 5, 7, 10, 13].includes(stepInBar)) {
      const pattern = [0, 3, 7, 10, 7, 3];
      const note = pattern[(bar + stepInBar) % pattern.length];
      this.synth(when, note, stepInBar % 4 === 0 ? 0.075 : 0.045);
    }

    if (active(3)) {
      if (stepInBar === 0) this.fxSweep(when, bar % 2 === 0);
      if (stepInBar === 6 || stepInBar === 14) {
        this.noise(when, 0.08, 0.03, 2_600);
      }
    }
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

  private bass(when: number, scaleOffset: number) {
    const midi = 36 + this.keyIndex + scaleOffset;
    this.tone(
      frequencyForMidi(midi),
      when,
      0.2,
      "sawtooth",
      0.085,
      430,
    );
  }

  private synth(when: number, scaleOffset: number, volume: number) {
    const midi = 60 + this.keyIndex + scaleOffset;
    this.tone(
      frequencyForMidi(midi),
      when,
      0.15,
      "triangle",
      volume,
      3_400,
    );
    this.tone(
      frequencyForMidi(midi + 12),
      when + 0.008,
      0.1,
      "sine",
      volume * 0.34,
      4_800,
    );
  }

  private fxSweep(when: number, rising: boolean) {
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
    filter.frequency.setValueAtTime(700, when);
    filter.frequency.exponentialRampToValueAtTime(2_800, when + 0.36);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.045, when + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.42);
  }
}
