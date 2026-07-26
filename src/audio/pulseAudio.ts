import {
  PULSE_STEP_SECONDS,
  type PulseChart,
  type PulseEvent,
  type PulseJudgement,
  type PulseLayer,
  type PulseRoute,
  type PulseState,
} from "@/game/pulse";

let sharedAudioContext: AudioContext | null = null;

const MASTER_GAIN = 0.36;
const SILENCE = 0.0001;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.14;
const DISPOSE_TAIL_SECONDS = 0.06;
const DISPOSE_DELAY_MS = 90;
const MINOR_SCALE = [0, 3, 5, 7, 10] as const;
const STEM_LEVELS = [0.96, 0.84, 0.72, 0.62] as const;
const HIT_LANE_BASE_MIDI = [82, 45, 69, 77] as const;
const HIT_LANE_ACCENT_INTERVAL = [12, 12, 7, 12] as const;

type PulseAudioEventSource = Pick<
  PulseEvent,
  "blockHash" | "calldataBytes" | "gasRatio" | "txCount"
>;

export interface PulseAudioProfile {
  readonly accentStep: number;
  readonly brightness: number;
  readonly energy: number;
  readonly patternOffset: number;
  readonly rising: boolean;
  readonly rootOffset: number;
  readonly swingSeconds: number;
  readonly variation: number;
}

export interface PulseHitVoiceProfile {
  readonly accentDelaySeconds: number | null;
  readonly accentMidi: number | null;
  readonly primaryMidi: number;
  readonly scaleDegree: (typeof MINOR_SCALE)[number];
}

interface ToneOptions {
  readonly attack?: number;
  readonly detune?: number;
  readonly duration: number;
  readonly filterFrequency?: number;
  readonly lane?: PulseLayer | null;
  readonly type: OscillatorType;
  readonly volume: number;
}

interface NoiseOptions {
  readonly duration: number;
  readonly frequency: number;
  readonly lane?: PulseLayer | null;
  readonly q?: number;
  readonly volume: number;
}

interface PulseAudioEvidenceWindow extends Window {
  __BASE_JAM_AUDIO_EVIDENCE_ENABLED__?: boolean;
  __BASE_JAM_AUDIO_EVIDENCE_STREAM__?: MediaStream;
}

function audioEvidenceWindow(): PulseAudioEvidenceWindow | null {
  return typeof window === "undefined"
    ? null
    : (window as PulseAudioEvidenceWindow);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function frequencyForMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function hexByte(hash: string, index: number): number {
  const normalized = hash.startsWith("0x") ? hash.slice(2) : hash;
  const byteCount = Math.max(1, Math.floor(normalized.length / 2));
  const offset = (((index % byteCount) + byteCount) % byteCount) * 2;
  const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Turns one Base block into a compact musical direction. Keeping this pure
 * makes a run reproducible: gas controls energy, calldata opens the timbre,
 * transaction load increases density, and the hash chooses the variation.
 */
export function derivePulseAudioProfile(
  event: PulseAudioEventSource | undefined,
  bar: number,
): PulseAudioProfile {
  const safeBar = Math.max(0, Math.trunc(bar));
  const hash = event?.blockHash ?? "0x00";
  const hashA = hexByte(hash, safeBar + 3);
  const hashB = hexByte(hash, safeBar + 17);
  const hashC = hexByte(hash, safeBar + 29);
  const gas = clamp01(event?.gasRatio ?? 0);
  const calldata = clamp01(
    Math.log2(1 + Math.max(0, event?.calldataBytes ?? 0)) / 18,
  );
  const transactionLoad = clamp01(
    Math.log2(1 + Math.max(0, event?.txCount ?? 0)) / 13,
  );
  const accentSteps = [5, 7, 10, 11, 13] as const;

  return {
    accentStep: accentSteps[hashA % accentSteps.length],
    brightness: 820 + calldata * 4_500 + (hashB / 255) * 720,
    energy: Math.min(
      0.96,
      0.22 +
        gas * 0.4 +
        transactionLoad * 0.19 +
        (hashA / 255) * 0.13,
    ),
    patternOffset: (hashA + hashB + safeBar) % 8,
    rising: (hashA + hashC) % 2 === 0,
    rootOffset: MINOR_SCALE[hashC % MINOR_SCALE.length],
    swingSeconds: 0.003 + (hashB % 6) * 0.0014,
    variation: (hashA << 8) | hashB,
  };
}

/**
 * Places every feedback voice on the same block-derived minor scale while
 * preserving a stable register for each stem. Perfect hits add one quiet,
 * grid-timed consonance; good hits stay as a single, shorter confirmation.
 */
export function derivePulseHitVoiceProfile(
  lane: PulseLayer,
  column: number,
  judgement: PulseJudgement,
  keyIndex: number,
  profile: Pick<PulseAudioProfile, "patternOffset">,
): PulseHitVoiceProfile {
  const safeColumn = Math.max(0, Math.trunc(column));
  const scaleDegree =
    MINOR_SCALE[
      (profile.patternOffset + lane + safeColumn) % MINOR_SCALE.length
    ];
  const primaryMidi = HIT_LANE_BASE_MIDI[lane] + keyIndex + scaleDegree;
  const perfect = judgement === "perfect";

  return {
    accentDelaySeconds: perfect ? PULSE_STEP_SECONDS / 2 : null,
    accentMidi: perfect
      ? primaryMidi + HIT_LANE_ACCENT_INTERVAL[lane]
      : null,
    primaryMidi,
    scaleDegree,
  };
}

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

export class PulseAudioEngine {
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly compressor: DynamicsCompressorNode | null;
  private readonly evidenceDestination:
    | MediaStreamAudioDestinationNode
    | null;
  private readonly feedbackBus: GainNode | null;
  private readonly stemBuses: readonly GainNode[];
  private readonly noiseBuffer: AudioBuffer | null;
  private readonly chart: PulseChart;
  private readonly keyIndex: number;
  private readonly getState: () => PulseState;
  private readonly activeVoices = new Map<
    AudioScheduledSourceNode,
    readonly AudioNode[]
  >();
  private nextStep = 0;
  private startAtPerformance = 0;
  private pausedAt = 0;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private muted = false;
  private paused = false;
  private running = false;
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
      this.master.gain.value = SILENCE;

      this.compressor = context.createDynamicsCompressor();
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;
      this.master.connect(this.compressor);
      this.compressor.connect(context.destination);

      const evidenceWindow = audioEvidenceWindow();
      if (evidenceWindow?.__BASE_JAM_AUDIO_EVIDENCE_ENABLED__ === true) {
        this.evidenceDestination =
          context.createMediaStreamDestination();
        this.compressor.connect(this.evidenceDestination);
        evidenceWindow.__BASE_JAM_AUDIO_EVIDENCE_STREAM__ =
          this.evidenceDestination.stream;
      } else {
        this.evidenceDestination = null;
      }

      this.stemBuses = STEM_LEVELS.map((level) => {
        const bus = context.createGain();
        bus.gain.value = level;
        bus.connect(this.master as GainNode);
        return bus;
      });
      this.feedbackBus = context.createGain();
      this.feedbackBus.gain.value = 0.82;
      this.feedbackBus.connect(this.master);

      this.noiseBuffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 1.5),
        context.sampleRate,
      );
      this.fillDeterministicNoise(this.noiseBuffer.getChannelData(0));
    } else {
      this.master = null;
      this.compressor = null;
      this.evidenceDestination = null;
      this.feedbackBus = null;
      this.stemBuses = [];
      this.noiseBuffer = null;
    }
  }

  start(leadInSeconds = 0.9) {
    if (this.disposed) return;
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.startAtPerformance = performance.now() + leadInSeconds * 1_000;
    this.pausedAt = -leadInSeconds;
    this.nextStep = 0;
    this.paused = false;
    this.running = true;
    this.stopped = false;
    this.setMasterLevel();
    void this.context?.resume();
    this.scheduleCountIn(leadInSeconds);
  }

  songTime(): number {
    if (!this.running || this.paused || this.stopped) return this.pausedAt;
    // Gameplay owns one monotonic clock. AudioContext can suspend or resume at
    // any time on mobile; using it as the score clock would jump the chart.
    const songTime = (performance.now() - this.startAtPerformance) / 1_000;
    this.pausedAt = songTime;
    return songTime;
  }

  pause(): boolean {
    if (!this.running || this.paused || this.stopped) return false;
    this.pausedAt = this.songTime();
    this.paused = true;
    this.setMasterLevel();
    return true;
  }

  resume(): boolean {
    if (!this.running || !this.paused || this.stopped) return false;
    this.startAtPerformance = performance.now() - this.pausedAt * 1_000;
    this.nextStep = Math.max(
      0,
      Math.ceil(Math.max(0, this.pausedAt) / PULSE_STEP_SECONDS),
    );
    this.paused = false;
    this.setMasterLevel();
    void this.context?.resume();
    return true;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isRunning(): boolean {
    return this.running && !this.stopped;
  }

  update() {
    if (
      !this.context ||
      !this.master ||
      this.context.state !== "running" ||
      !this.running ||
      this.paused ||
      this.stopped
    ) {
      return;
    }

    const songTime = this.songTime();
    const scheduleThroughSongTime =
      songTime + SCHEDULE_LOOKAHEAD_SECONDS;
    while (this.nextStep * PULSE_STEP_SECONDS < scheduleThroughSongTime) {
      const stepSongTime = this.nextStep * PULSE_STEP_SECONDS;
      const when =
        this.context.currentTime + Math.max(0, stepSongTime - songTime);
      if (!this.muted && stepSongTime >= songTime - 0.02) {
        this.scheduleStep(this.nextStep, when, this.getState());
      }
      this.nextStep += 1;
    }
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    this.setMasterLevel();
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  hit(lane: PulseLayer, column: number, judgement: PulseJudgement) {
    if (!this.canSound()) return;
    void this.context?.resume();

    const when = (this.context as AudioContext).currentTime + 0.003;
    const profile = this.profileForBar(this.currentBar());
    const voice = derivePulseHitVoiceProfile(
      lane,
      column,
      judgement,
      this.keyIndex,
      profile,
    );
    const perfect = judgement === "perfect";
    const accentWhen =
      voice.accentMidi === null || voice.accentDelaySeconds === null
        ? null
        : when + voice.accentDelaySeconds;

    if (lane === 0) {
      this.tone(frequencyForMidi(voice.primaryMidi), when, {
        attack: 0.002,
        duration: perfect ? 0.09 : 0.056,
        filterFrequency: 7_200,
        type: "sine",
        volume: perfect ? 0.092 : 0.052,
      });
      this.noise(when, {
        duration: perfect ? 0.032 : 0.018,
        frequency: 4_800,
        q: 1.8,
        volume: perfect ? 0.023 : 0.011,
      });
      if (voice.accentMidi !== null && accentWhen !== null) {
        this.tone(frequencyForMidi(voice.accentMidi), accentWhen, {
          attack: 0.002,
          duration: 0.065,
          filterFrequency: 7_600,
          type: "sine",
          volume: 0.032,
        });
      }
      return;
    }

    if (lane === 1) {
      this.tone(frequencyForMidi(voice.primaryMidi), when, {
        attack: 0.004,
        duration: perfect ? 0.19 : 0.105,
        filterFrequency: 760,
        type: "triangle",
        volume: perfect ? 0.092 : 0.058,
      });
      if (voice.accentMidi !== null && accentWhen !== null) {
        this.tone(frequencyForMidi(voice.accentMidi), accentWhen, {
          attack: 0.003,
          duration: 0.12,
          filterFrequency: 1_250,
          type: "sine",
          volume: 0.038,
        });
      }
      return;
    }

    if (lane === 2) {
      this.tone(frequencyForMidi(voice.primaryMidi), when, {
        attack: 0.003,
        duration: perfect ? 0.23 : 0.12,
        filterFrequency: 5_200,
        type: "triangle",
        volume: perfect ? 0.084 : 0.052,
      });
      if (voice.accentMidi !== null && accentWhen !== null) {
        this.tone(frequencyForMidi(voice.accentMidi), accentWhen, {
          attack: 0.004,
          duration: 0.21,
          filterFrequency: 6_400,
          type: "sine",
          volume: 0.04,
        });
      }
      return;
    }

    const root = frequencyForMidi(voice.primaryMidi);
    this.chirp(
      when,
      perfect ? root * 0.78 : root * 0.94,
      perfect ? root * 1.42 : root * 1.08,
      perfect ? 0.18 : 0.085,
      perfect ? 0.06 : 0.034,
      null,
    );
    if (voice.accentMidi !== null && accentWhen !== null) {
      this.tone(frequencyForMidi(voice.accentMidi), accentWhen, {
        attack: 0.003,
        duration: 0.13,
        filterFrequency: 7_200,
        type: "sine",
        volume: 0.03,
      });
    }
  }

  /**
   * A low-volume directional zip confirms that the playhead changed faces.
   * The interval direction carries left/right without competing with the
   * stem's judgement voice.
   */
  routeSwitch(direction: Exclude<PulseRoute, 0>, accepted: boolean) {
    if (!this.canSound() || !this.context) return;

    const when = this.context.currentTime + 0.002;
    const profile = this.profileForBar(this.currentBar());
    const root = frequencyForMidi(
      72 + this.keyIndex + profile.rootOffset,
    );
    const low = direction < 0 ? root * 1.5 : root;
    const high = direction < 0 ? root : root * 1.5;
    this.chirp(
      when,
      low,
      high,
      accepted ? 0.082 : 0.055,
      accepted ? 0.022 : 0.012,
      null,
    );
    if (accepted) {
      this.tone(
        high,
        when + PULSE_STEP_SECONDS / 2,
        {
          attack: 0.002,
          duration: 0.052,
          filterFrequency: 5_800,
          type: "sine",
          volume: 0.014,
        },
      );
    }
  }

  miss(kind: "wrong" | "late" = "late") {
    if (!this.canSound() || !this.master || !this.context) return;
    void this.context.resume();

    const when = this.context.currentTime;
    const dip = kind === "wrong" ? 0.105 : 0.165;
    if (typeof this.master.gain.cancelAndHoldAtTime === "function") {
      this.master.gain.cancelAndHoldAtTime(when);
    } else {
      this.master.gain.cancelScheduledValues(when);
      this.master.gain.setValueAtTime(MASTER_GAIN, when);
    }
    this.master.gain.linearRampToValueAtTime(dip, when + 0.02);
    this.master.gain.setValueAtTime(dip, when + 0.052);
    this.master.gain.setTargetAtTime(
      MASTER_GAIN,
      when + 0.058,
      kind === "wrong" ? 0.055 : 0.072,
    );
    this.negative(when, kind === "wrong");
  }

  /**
   * A successful phrase does two things at once: it introduces the captured
   * stem in its own voice and lands a shared harmonic "seal" over 1.3 seconds.
   */
  capture(lane: PulseLayer, judgement: PulseJudgement = "good") {
    if (!this.canSound() || !this.context) return;

    const when = this.context.currentTime + 0.008;
    const profile = this.profileForBar(this.currentBar());
    const rootMidi = 60 + this.keyIndex + profile.rootOffset;
    const perfect = judgement === "perfect";

    // A tiny processor latch precedes the authored stem flourish. It gives
    // phrase completion a consistent tactile identity on phone speakers.
    this.noise(when, {
      duration: 0.022,
      frequency: 2_600 + profile.energy * 1_400,
      q: 1.4,
      volume: perfect ? 0.022 : 0.015,
    });
    this.tone(frequencyForMidi(rootMidi + 24), when, {
      attack: 0.002,
      duration: perfect ? 0.085 : 0.06,
      filterFrequency: 6_600,
      type: "sine",
      volume: perfect ? 0.04 : 0.026,
    });

    if (lane === 0) {
      this.kick(when, 0.15);
      this.hat(when + 0.12, 0.026);
      this.hat(when + 0.24, 0.032);
      this.snare(when + 0.36, 0.082);
      this.kick(when + 0.58, 0.13, 172);
      this.hat(when + 0.75, 0.045, true);
    } else if (lane === 1) {
      [0, 3, 7, 10, 12].forEach((interval, index) => {
        this.bass(
          when + index * 0.135,
          profile.rootOffset + interval,
          profile.brightness,
          0.09 + index * 0.005,
          index === 4 ? 0.5 : 0.2,
        );
      });
    } else if (lane === 2) {
      [0, 3, 7, 10, 12, 15].forEach((interval, index) => {
        this.synth(
          when + index * 0.105,
          profile.rootOffset + interval,
          0.046 + index * 0.004,
          profile.brightness,
          index === 5 ? 0.48 : 0.17,
        );
      });
    } else {
      this.fxSweep(
        when,
        true,
        profile.brightness,
        profile.energy,
        0.88,
      );
      [0, 7, 10, 15].forEach((interval, index) => {
        const frequency = frequencyForMidi(rootMidi + 12 + interval);
        this.chirp(
          when + 0.16 + index * 0.14,
          frequency * 0.76,
          frequency,
          0.16,
          0.032 + index * 0.004,
          3,
        );
      });
    }

    // The common seal makes every capture recognizable regardless of stem.
    const sealIntervals = perfect ? [0, 3, 7, 12] : [0, 3, 7];
    sealIntervals.forEach((interval, index) => {
      this.tone(
        frequencyForMidi(rootMidi + 12 + interval),
        when + 0.72 + index * 0.018,
        {
          attack: 0.02,
          duration: 0.56,
          filterFrequency: 3_400 + profile.energy * 2_000,
          type: index === 0 ? "triangle" : "sine",
          volume:
            index === 0
              ? perfect
                ? 0.058
                : 0.046
              : perfect
                ? 0.038
                : 0.03,
        },
      );
    });
    this.chirp(
      when + 1.02,
      frequencyForMidi(rootMidi + 19),
      frequencyForMidi(rootMidi + (perfect ? 24 : 22)),
      perfect ? 0.25 : 0.18,
      perfect ? 0.028 : 0.018,
      null,
    );
  }

  stop() {
    if (this.stopped || this.disposed) return;
    this.pausedAt = this.songTime();
    this.stopped = true;
    this.running = false;
    this.setMasterLevel();
    if (!this.context) {
      this.dispose();
      return;
    }
    this.stopActiveVoices(
      this.context.currentTime + DISPOSE_TAIL_SECONDS,
    );
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.dispose();
    }, DISPOSE_DELAY_MS);
  }

  /**
   * Permanently releases this run's graph from the shared AudioContext.
   * Idempotence matters because finish, unmount, and a delayed tail may all
   * converge on shutdown during route transitions.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.stopped = true;
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }

    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(SILENCE, now);
      this.stopActiveVoices(now);
    }
    for (const source of [...this.activeVoices.keys()]) {
      this.releaseVoice(source);
    }
    for (const bus of this.stemBuses) bus.disconnect();
    this.feedbackBus?.disconnect();
    this.master?.disconnect();
    if (this.evidenceDestination) {
      const evidenceWindow = audioEvidenceWindow();
      if (
        evidenceWindow?.__BASE_JAM_AUDIO_EVIDENCE_STREAM__ ===
        this.evidenceDestination.stream
      ) {
        delete evidenceWindow.__BASE_JAM_AUDIO_EVIDENCE_STREAM__;
      }
      for (const track of this.evidenceDestination.stream.getTracks()) {
        track.stop();
      }
      this.evidenceDestination.disconnect();
    }
    this.compressor?.disconnect();
  }

  private canSound(): boolean {
    return Boolean(
      this.context &&
        this.master &&
        this.running &&
        !this.muted &&
        !this.paused &&
        !this.stopped,
    );
  }

  private setMasterLevel() {
    if (!this.master || !this.context || this.disposed) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(
      this.muted || this.paused || this.stopped || !this.running
        ? SILENCE
        : MASTER_GAIN,
      this.context.currentTime,
      0.018,
    );
  }

  private currentBar(): number {
    return Math.floor(Math.max(0, this.songTime()) / 2);
  }

  private profileForBar(bar: number): PulseAudioProfile {
    const event =
      this.chart.events[
        Math.min(Math.max(0, bar), Math.max(0, this.chart.events.length - 1))
      ];
    return derivePulseAudioProfile(event, bar);
  }

  private scheduleCountIn(leadInSeconds: number) {
    if (!this.canSound() || !this.context || leadInSeconds < 0.45) return;
    const beatSeconds = 0.5;
    const beats = Math.min(3, Math.max(1, Math.floor(leadInSeconds / beatSeconds)));
    const firstAt =
      this.context.currentTime +
      Math.max(0.05, leadInSeconds - beats * beatSeconds);
    for (let index = 0; index < beats; index += 1) {
      this.tone(
        frequencyForMidi(84 + this.keyIndex + (index === beats - 1 ? 3 : 0)),
        firstAt + index * beatSeconds,
        {
          attack: 0.002,
          duration: 0.055,
          filterFrequency: 6_000,
          type: "sine",
          volume: index === beats - 1 ? 0.052 : 0.032,
        },
      );
    }
  }

  private scheduleStep(step: number, when: number, state: PulseState) {
    const stepInBar = step % 16;
    const bar = Math.floor(step / 16);
    const profile = this.profileForBar(bar);
    const swingWhen =
      when + (stepInBar % 2 === 1 ? profile.swingSeconds : 0);
    const active = (lane: PulseLayer) =>
      state.capturedUntilBar[lane] > bar;

    // The un-captured mix still has a quiet guide pulse, so the first command
    // is understandable before the player has earned the full beat stem.
    if (stepInBar === 0) {
      this.kick(swingWhen, active(0) ? 0.14 + profile.energy * 0.04 : 0.06);
    } else if (stepInBar % 4 === 0 && !active(0)) {
      this.hat(swingWhen, 0.012 + profile.energy * 0.007);
    }

    if (active(0)) {
      if (
        stepInBar === 8 ||
        (profile.energy > 0.76 && stepInBar === profile.accentStep)
      ) {
        this.kick(swingWhen, 0.105 + profile.energy * 0.045);
      }
      if (stepInBar === 4 || stepInBar === 12) {
        this.snare(swingWhen, 0.072 + profile.energy * 0.03);
      }
      if (
        stepInBar % 2 === 0 ||
        (profile.energy > 0.7 && stepInBar % 4 === 3)
      ) {
        this.hat(
          swingWhen,
          0.021 + profile.energy * 0.017,
          stepInBar === profile.accentStep,
        );
      }
    }

    const bassSteps =
      profile.energy > 0.68 ? [0, 3, 6, 8, 11, 14] : [0, 3, 8, 11];
    if (active(1) && bassSteps.includes(stepInBar)) {
      const pattern = [0, 0, 3, 5, 0, 7, 3, 10] as const;
      const note =
        pattern[
          (profile.patternOffset + bar * 2 + Math.floor(stepInBar / 3)) %
            pattern.length
        ];
      this.bass(
        swingWhen,
        profile.rootOffset + note,
        profile.brightness,
        0.072 + profile.energy * 0.025,
      );
    }

    const synthSteps =
      profile.energy > 0.58 ? [0, 2, 5, 7, 10, 13] : [0, 5, 10, 13];
    if (active(2) && synthSteps.includes(stepInBar)) {
      const pattern = [0, 3, 7, 10, 7, 3] as const;
      const note =
        pattern[
          (profile.patternOffset + bar + stepInBar) % pattern.length
        ];
      this.synth(
        swingWhen,
        profile.rootOffset + note,
        (stepInBar % 4 === 0 ? 0.055 : 0.034) +
          profile.energy * 0.016,
        profile.brightness,
      );
    }

    if (active(3)) {
      if (stepInBar === 0) {
        this.fxSweep(
          swingWhen,
          profile.rising,
          profile.brightness,
          profile.energy,
        );
      }
      if (stepInBar === 6 || stepInBar === 14) {
        this.noise(swingWhen, {
          duration: 0.055 + profile.energy * 0.035,
          frequency: profile.brightness,
          lane: 3,
          q: 2.4,
          volume: 0.016 + profile.energy * 0.018,
        });
      }
      if (stepInBar === profile.accentStep) {
        const root = frequencyForMidi(
          72 + this.keyIndex + profile.rootOffset,
        );
        this.chirp(
          swingWhen,
          profile.rising ? root : root * 1.5,
          profile.rising ? root * 1.5 : root,
          0.12,
          0.026,
          3,
        );
      }
    }

    // A stem expires on a bar boundary. Give it a short authored hand-off
    // instead of simply deleting it from the next scheduler tick.
    if (stepInBar === 14) {
      ([0, 1, 2, 3] as const).forEach((lane) => {
        if (
          active(lane) &&
          state.capturedUntilBar[lane] === bar + 1
        ) {
          this.releaseStem(lane, swingWhen, profile);
        }
      });
    }
  }

  private outputFor(lane: PulseLayer | null): AudioNode | null {
    if (lane === null) return this.feedbackBus ?? this.master;
    return this.stemBuses[lane] ?? this.master;
  }

  private trackVoice(
    source: AudioScheduledSourceNode,
    nodes: readonly AudioNode[],
  ) {
    if (this.disposed) {
      try {
        source.stop(this.context?.currentTime ?? 0);
      } catch {
        // The source may have ended before a late teardown reached it.
      }
      for (const node of nodes) node.disconnect();
      return;
    }
    this.activeVoices.set(source, nodes);
    source.onended = () => this.releaseVoice(source);
  }

  private releaseVoice(source: AudioScheduledSourceNode) {
    const nodes = this.activeVoices.get(source);
    if (!nodes) return;
    this.activeVoices.delete(source);
    source.onended = null;
    for (const node of nodes) node.disconnect();
  }

  private stopActiveVoices(when: number) {
    for (const source of this.activeVoices.keys()) {
      try {
        // Re-scheduling stop before a future start prevents preroll and phrase
        // voices from waking a graph after the run has already been destroyed.
        source.stop(when);
      } catch {
        // A source that has already ended will release itself via onended.
      }
    }
  }

  private tone(
    frequency: number,
    when: number,
    options: ToneOptions,
  ) {
    if (!this.context) return;
    const output = this.outputFor(options.lane ?? null);
    if (!output) return;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const attack = Math.min(
      Math.max(0.001, options.attack ?? 0.007),
      options.duration * 0.45,
    );
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), when);
    oscillator.detune.setValueAtTime(options.detune ?? 0, when);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(
      Math.max(80, options.filterFrequency ?? 7_000),
      when,
    );
    gain.gain.setValueAtTime(SILENCE, when);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(SILENCE, options.volume),
      when + attack,
    );
    gain.gain.exponentialRampToValueAtTime(
      SILENCE,
      when + options.duration,
    );
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(when);
    oscillator.stop(when + options.duration + 0.025);
    this.trackVoice(oscillator, [oscillator, filter, gain]);
  }

  private chirp(
    when: number,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    lane: PulseLayer | null,
  ) {
    if (!this.context) return;
    const output = this.outputFor(lane);
    if (!output) return;

    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), when);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      when + duration,
    );
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(
      Math.max(180, startFrequency * 1.4),
      when,
    );
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(220, endFrequency * 1.5),
      when + duration,
    );
    filter.Q.value = 2.8;
    gain.gain.setValueAtTime(SILENCE, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(SILENCE, when + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.025);
    this.trackVoice(oscillator, [oscillator, filter, gain]);
  }

  private kick(when: number, volume: number, pitch = 148) {
    if (!this.context) return;
    const output = this.outputFor(0);
    if (!output) return;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(pitch, when);
    oscillator.frequency.exponentialRampToValueAtTime(46, when + 0.13);
    gain.gain.setValueAtTime(Math.max(SILENCE, volume), when);
    gain.gain.exponentialRampToValueAtTime(SILENCE, when + 0.19);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(when);
    oscillator.stop(when + 0.21);
    this.trackVoice(oscillator, [oscillator, gain]);
  }

  private snare(when: number, volume: number) {
    this.noise(when, {
      duration: 0.115,
      frequency: 1_850,
      lane: 0,
      q: 0.9,
      volume,
    });
    this.tone(178, when, {
      attack: 0.002,
      duration: 0.085,
      filterFrequency: 1_200,
      lane: 0,
      type: "triangle",
      volume: volume * 0.42,
    });
  }

  private hat(when: number, volume: number, open = false) {
    this.noise(when, {
      duration: open ? 0.15 : 0.035,
      frequency: 7_200,
      lane: 0,
      q: 0.7,
      volume,
    });
  }

  private noise(when: number, options: NoiseOptions) {
    if (!this.context || !this.noiseBuffer) return;
    const output = this.outputFor(options.lane ?? null);
    if (!output) return;

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = options.frequency > 4_000 ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(
      Math.max(120, options.frequency),
      when,
    );
    filter.Q.setValueAtTime(options.q ?? 0.8, when);
    gain.gain.setValueAtTime(Math.max(SILENCE, options.volume), when);
    gain.gain.exponentialRampToValueAtTime(
      SILENCE,
      when + options.duration,
    );
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    const maxOffset = Math.max(
      0,
      this.noiseBuffer.duration - options.duration - 0.01,
    );
    const offset = maxOffset > 0 ? (when * 0.731) % maxOffset : 0;
    source.start(when, offset);
    source.stop(when + options.duration + 0.01);
    this.trackVoice(source, [source, filter, gain]);
  }

  private bass(
    when: number,
    scaleOffset: number,
    brightness: number,
    volume = 0.088,
    duration = 0.22,
  ) {
    const midi = 35 + this.keyIndex + scaleOffset;
    const cutoff = Math.min(920, 330 + brightness * 0.1);
    this.tone(frequencyForMidi(midi), when, {
      attack: 0.004,
      duration,
      filterFrequency: cutoff,
      lane: 1,
      type: "sawtooth",
      volume,
    });
    this.tone(frequencyForMidi(midi - 12), when, {
      attack: 0.006,
      duration: duration + 0.035,
      filterFrequency: 420,
      lane: 1,
      type: "sine",
      volume: volume * 0.52,
    });
  }

  private synth(
    when: number,
    scaleOffset: number,
    volume: number,
    brightness: number,
    duration = 0.16,
  ) {
    const midi = 60 + this.keyIndex + scaleOffset;
    this.tone(frequencyForMidi(midi), when, {
      attack: 0.004,
      duration,
      filterFrequency: Math.min(5_800, 1_500 + brightness * 0.72),
      lane: 2,
      type: "triangle",
      volume,
    });
    this.tone(frequencyForMidi(midi + 12), when + 0.008, {
      attack: 0.003,
      duration: Math.max(0.09, duration * 0.7),
      filterFrequency: Math.min(7_200, 2_200 + brightness),
      lane: 2,
      type: "sine",
      volume: volume * 0.32,
    });
  }

  private fxSweep(
    when: number,
    rising: boolean,
    brightness: number,
    energy: number,
    duration = 0.4,
  ) {
    if (!this.context) return;
    const output = this.outputFor(3);
    if (!output) return;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(rising ? 82 : 196, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      rising ? 360 : 74,
      when + duration,
    );
    filter.type = "bandpass";
    filter.Q.value = 4.5;
    filter.frequency.setValueAtTime(
      rising ? Math.max(360, brightness * 0.26) : Math.max(900, brightness),
      when,
    );
    filter.frequency.exponentialRampToValueAtTime(
      rising ? Math.max(1_100, brightness) : Math.max(320, brightness * 0.22),
      when + duration,
    );
    gain.gain.setValueAtTime(SILENCE, when);
    gain.gain.exponentialRampToValueAtTime(
      0.022 + energy * 0.026,
      when + Math.min(0.04, duration * 0.2),
    );
    gain.gain.exponentialRampToValueAtTime(SILENCE, when + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.025);
    this.trackVoice(oscillator, [oscillator, filter, gain]);
  }

  private releaseStem(
    lane: PulseLayer,
    when: number,
    profile: PulseAudioProfile,
  ) {
    if (lane === 0) {
      this.hat(when, 0.035, true);
      return;
    }
    if (lane === 1) {
      this.bass(
        when,
        profile.rootOffset + 7,
        profile.brightness,
        0.058,
        0.18,
      );
      this.bass(
        when + 0.18,
        profile.rootOffset,
        profile.brightness,
        0.052,
        0.36,
      );
      return;
    }
    if (lane === 2) {
      this.synth(
        when,
        profile.rootOffset,
        0.04,
        profile.brightness,
        0.42,
      );
      return;
    }
    this.fxSweep(
      when,
      false,
      profile.brightness,
      profile.energy * 0.7,
      0.55,
    );
  }

  private negative(when: number, wrong: boolean) {
    if (!this.context) return;
    const output = this.outputFor(null);
    if (!output) return;

    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(wrong ? 132 : 116, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      wrong ? 88 : 76,
      when + 0.1,
    );
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(wrong ? 620 : 480, when);
    gain.gain.setValueAtTime(wrong ? 0.032 : 0.023, when);
    gain.gain.exponentialRampToValueAtTime(SILENCE, when + 0.12);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    oscillator.start(when);
    oscillator.stop(when + 0.14);
    this.trackVoice(oscillator, [oscillator, filter, gain]);
    this.noise(when, {
      duration: 0.026,
      frequency: wrong ? 980 : 720,
      q: 2.2,
      volume: wrong ? 0.018 : 0.011,
    });
  }

  private fillDeterministicNoise(channel: Float32Array) {
    const firstHash = this.chart.events[0]?.blockHash ?? "0x6a09e667";
    let seed =
      ((hexByte(firstHash, 0) << 24) |
        (hexByte(firstHash, 1) << 16) |
        (hexByte(firstHash, 2) << 8) |
        hexByte(firstHash, 3)) >>>
      0;
    if (seed === 0) seed = 0x6a09e667;
    for (let index = 0; index < channel.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      channel[index] = ((seed >>> 0) / 0x80000000 - 1) * 0.92;
    }
  }
}
