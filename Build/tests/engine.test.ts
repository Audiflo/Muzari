import { StateMachine } from "../src/core/engine/state";
import { QueueManager } from "../src/core/engine/queue";
import { Scheduler, CrossfadeScheduler, GaplessScheduler } from "../src/core/engine/scheduler";
import { KomorebiEngine, IAudioBackend } from "../src/core/engine/engine";
import type { Track, Playlist } from "../src/core/engine/types";
import { MAX_CROSSFADE_SECONDS } from "../src/platform/audio/clamp";
import { MAX_REPLAY_GAIN_DB } from "../src/platform/audio/replayGain";
import { describe, it, jest, expect, beforeEach, afterEach } from "@jest/globals";

const createMockTrack = (id: string, duration = 180): Track => ({
  id,
  title: `Track ${id}`,
  artist: "Test Artist",
  album: "Test Album",
  duration,
  url: `file:///test/${id}.mp3`,
});

const createMockPlaylist = (trackIds: string[]): Playlist => ({
  id: "test-playlist",
  name: "Test Playlist",
  songs: trackIds.map((id) => createMockTrack(id)),
});

const createMockBackend = (): IAudioBackend => ({
  load: jest.fn().mockResolvedValue(undefined),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  stop: jest.fn(),
  seek: jest.fn(),
  setVolume: jest.fn(),
  setPlaybackRate: jest.fn(),
  setReplayGain: jest.fn(),
  getCurrentTime: () => 0,
  getDuration: () => 180,
  onDurationChange: jest.fn(),
  offDurationChange: jest.fn(),
  onEnded: jest.fn(),
  offEnded: jest.fn(),
  onError: jest.fn(),
  offError: jest.fn(),
  dispose: jest.fn(),
});

describe("StateMachine", () => {
  it("should start in idle state", () => {
    const sm = new StateMachine();
    expect(sm.getState()).toBe("idle");
  });

  it("should transition from idle to loading", () => {
    const sm = new StateMachine();
    const result = sm.transition("loading");
    expect(result).toBe(true);
    expect(sm.getState()).toBe("loading");
  });

  it("should reject invalid transitions loudly", () => {
    const sm = new StateMachine();
    sm.transition("loading");
    let thrown: unknown;
    try {
      sm.transition("playing");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("loading");
    expect((thrown as Error).message).toContain("playing");
    expect(sm.getState()).toBe("loading");
  });

  it("should force transition when needed", () => {
    const sm = new StateMachine();
    sm.transition("loading");
    const result = sm.transition("playing", true);
    expect(result).toBe(true);
    expect(sm.getState()).toBe("playing");
  });

  it("should report playing state correctly", () => {
    const sm = new StateMachine();
    expect(sm.isPlaying()).toBe(false);
    sm.transition("loading");
    sm.transition("ready");
    sm.transition("playing");
    expect(sm.isPlaying()).toBe(true);
  });

  it("should track history", () => {
    const sm = new StateMachine();
    sm.transition("loading");
    sm.transition("ready");
    sm.transition("playing");
    expect(sm.getHistory().length).toBe(3);
  });
});

describe("QueueManager", () => {
  let queue: QueueManager;

  beforeEach(() => {
    queue = new QueueManager();
  });

  it("should set playlist", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    expect(queue.getTracks().length).toBe(3);
  });

  it("should get current track", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(1);
    expect(queue.getCurrentTrack()?.id).toBe("b");
  });

  it("should handle next track", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(0);
    const next = queue.getNextTrack(false);
    expect(next?.id).toBe("b");
  });

  it("should handle previous track", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(1);
    const prev = queue.getPreviousTrack(false);
    expect(prev?.id).toBe("a");
  });

  it("should wrap around at end of playlist only with wrap enabled", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(2);
    expect(queue.getNextTrack(false)).toBeNull();
    expect(queue.getNextTrack(false, true)?.id).toBe("a");
  });

  it("should wrap around at start of playlist only with wrap enabled", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(0);
    expect(queue.getPreviousTrack(false)).toBeNull();
    expect(queue.getPreviousTrack(false, true)?.id).toBe("c");
  });

  it("should shuffle tracks", () => {
    const playlist = createMockPlaylist(["a", "b", "c", "d", "e"]);
    queue.setPlaylist(playlist);
    queue.jumpToIndex(2);
    queue.shuffle(true);
    expect(queue.isShuffled()).toBe(true);
    expect(queue.getTracks().length).toBe(5);
  });

  it("should unshuffle tracks", () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    queue.setPlaylist(playlist);
    queue.shuffle();
    queue.unshuffle();
    expect(queue.isShuffled()).toBe(false);
  });

  it("should update play history", () => {
    queue.updateHistory("track-1");
    const history = queue.getPlayHistory("track-1");
    expect(history?.playCount).toBe(1);

    queue.updateHistory("track-1");
    const history2 = queue.getPlayHistory("track-1");
    expect(history2?.playCount).toBe(2);
  });

  it("should add tracks", () => {
    queue.addTrack(createMockTrack("new"));
    expect(queue.getTracks().length).toBe(1);
  });

  it("should remove tracks", () => {
    queue.addTrack(createMockTrack("a"));
    queue.addTrack(createMockTrack("b"));
    queue.removeTrack("a");
    expect(queue.getTracks().length).toBe(1);
    expect(queue.getTracks()[0]?.id).toBe("b");
  });
});

describe("CrossfadeScheduler", () => {
  let scheduler: CrossfadeScheduler;

  beforeEach(() => {
    scheduler = new CrossfadeScheduler();
  });

  it("should start disabled", () => {
    expect(scheduler.isEnabled()).toBe(false);
  });

  it("should enable crossfade", () => {
    scheduler.setConfig({ enabled: true, duration: 3, shape: "equalpower" });
    expect(scheduler.isEnabled()).toBe(true);
  });

  it("derives the trigger point directly from the second-valued config", () => {
    scheduler.setConfig({ enabled: true, duration: 3, shape: "linear" });
    expect(scheduler.calculateTriggerTime(180)).toBe(177);
  });

  it("does not trigger before the crossfade window", () => {
    scheduler.setConfig({ enabled: true, duration: 3, shape: "linear" });
    expect(scheduler.shouldTrigger(0, 180)).toBe(false);
    expect(scheduler.shouldTrigger(100, 180)).toBe(false);
    expect(scheduler.shouldTrigger(176.9, 180)).toBe(false);
    expect(scheduler.shouldTrigger(177, 180)).toBe(true);
  });

  it("never triggers when the crossfade is longer than the track", () => {
    scheduler.setConfig({ enabled: true, duration: 10, shape: "linear" });
    expect(scheduler.calculateTriggerTime(3)).toBeNull();
    expect(scheduler.shouldTrigger(0, 3)).toBe(false);
  });

  it("should calculate equalpower curve", () => {
    scheduler.setConfig({ enabled: true, duration: 3, shape: "equalpower" });
    const { fromVolume, toVolume } = scheduler.calculateVolumes(0.5);
    expect(fromVolume).toBeCloseTo(0.707, 2);
    expect(toVolume).toBeCloseTo(0.707, 2);
  });

  it("should calculate linear curve", () => {
    scheduler.setConfig({ enabled: true, duration: 3, shape: "linear" });
    const { fromVolume, toVolume } = scheduler.calculateVolumes(0.5);
    expect(fromVolume).toBe(0.5);
    expect(toVolume).toBe(0.5);
  });
});

describe("GaplessScheduler", () => {
  let scheduler: GaplessScheduler;

  beforeEach(() => {
    scheduler = new GaplessScheduler();
  });

  it("should start disabled to match the engine default", () => {
    expect(scheduler.isEnabled()).toBe(false);
  });

  it("converts encoder delay from samples to seconds", () => {
    const track = createMockTrack("a", 180);
    track.encoding = { sampleRate: 1000 };
    track.gapless = { encoderDelay: 100, encoderPadding: 50 };
    expect(scheduler.getStartOffset(track)).toBeCloseTo(0.1, 10);
  });

  it("converts encoder padding to seconds when ending playback", () => {
    const track = createMockTrack("a", 180);
    track.encoding = { sampleRate: 1000 };
    track.gapless = { encoderDelay: 0, encoderPadding: 50 };
    expect(scheduler.calculatePlayEnd(track)).toBeCloseTo(179.95, 10);
  });

  it("falls back to the configured offset when gapless info is absent", () => {
    const track = createMockTrack("a", 180);
    scheduler.setConfig({ startOffset: 0.25, endOffset: 0.5 });

    expect(scheduler.getStartOffset(track)).toBe(0.25);
    expect(scheduler.getEndOffset(track)).toBe(0.5);
    expect(scheduler.calculatePlayEnd(track)).toBeCloseTo(179.5, 10);
  });

  it("falls back to the configured offset when the sample rate is unusable", () => {
    const track = createMockTrack("a", 180);
    track.encoding = { sampleRate: 0 };
    track.gapless = { encoderDelay: 100, encoderPadding: 50 };
    scheduler.setConfig({ startOffset: 0, endOffset: 0 });
    expect(scheduler.getStartOffset(track)).toBe(0);
    expect(scheduler.getEndOffset(track)).toBe(0);
    expect(scheduler.calculatePlayEnd(track)).toBe(180);
  });

  it("does not transition on the first time update when duration is unknown", () => {
    const track = createMockTrack("a", 0);
    expect(scheduler.shouldTransition(0, track)).toBe(false);
  });

  it("still transitions at the end of a track with a known duration", () => {
    const track = createMockTrack("a", 180);
    expect(scheduler.shouldTransition(179.8, track)).toBe(false);
    expect(scheduler.shouldTransition(179.9, track)).toBe(true);
  });

  it("does not treat a non-finite duration as an instant transition", () => {
    const track = createMockTrack("a", Number.NaN);
    expect(scheduler.shouldTransition(0, track)).toBe(false);
  });

  it("does not preload against an unknown duration", () => {
    expect(scheduler.shouldPreload(0, 0)).toBe(false);
    expect(scheduler.shouldPreload(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(scheduler.shouldPreload(0, 180)).toBe(false);
    expect(scheduler.shouldPreload(175, 180)).toBe(true);
  });
});

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  it("should prioritize crossfade over gapless when both are enabled", () => {
    scheduler.setCrossfadeConfig({ enabled: true, duration: 3, shape: "linear" });
    scheduler.setGaplessConfig({ enabled: true });
    expect(scheduler.getMode()).toBe("crossfade");
  });

  it("should use crossfade when gapless disabled", () => {
    scheduler.setCrossfadeConfig({ enabled: true, duration: 3, shape: "linear" });
    scheduler.setGaplessConfig({ enabled: false });
    expect(scheduler.getMode()).toBe("crossfade");
  });
});

describe("KomorebiEngine", () => {
  let engine: KomorebiEngine;
  let backend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    backend = createMockBackend();
    engine = new KomorebiEngine(backend, {
      crossfade: { duration: 0, shape: "linear" },
      gapless: { enabled: true },
      smartShuffle: true,
      autoPlayNext: true,
    });
  });

  afterEach(() => {
    engine.dispose();
    jest.clearAllMocks();
  });

  it("should start in idle state", () => {
    expect(engine.getState().state).toBe("idle");
  });

  it("should load track and transition to ready", async () => {
    const track = createMockTrack("test-1");
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.getState().state).toBe("ready");
  });

  it("should play track", async () => {
    const track = createMockTrack("test-1");
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    await engine.play();
    expect(engine.getState().state).toBe("playing");
  });

  it("should pause track", async () => {
    const track = createMockTrack("test-1");
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    await engine.play();
    engine.pause();
    expect(engine.getState().state).toBe("paused");
  });

  it("should emit state change events", async () => {
    const states: string[] = [];
    engine.on("statechange", (e) => states.push(e.newState));

    const track = createMockTrack("test-1");
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    await engine.play();
    engine.pause();

    expect(states).toContain("ready");
    expect(states).toContain("playing");
    expect(states).toContain("paused");
  });

  it("should emit track change events", async () => {
    const changes: Array<{ from: string | null; to: string | null }> = [];
    engine.on("trackchange", (e) => {
      changes.push({ from: e.from?.id ?? null, to: e.to?.id ?? null });
    });

    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    engine.load(playlist.songs[0]);
    await engine.play();
    await engine.next();

    expect(changes.length).toBeGreaterThan(0);
  });

  it("should handle volume changes", () => {
    engine.setVolume(0.5);
    expect(engine.getState().settings.volume).toBe(0.5);
    expect(backend.setVolume).toHaveBeenCalledWith(0.5);
  });

  it("should clamp volume", () => {
    engine.setVolume(1.5);
    expect(engine.getState().settings.volume).toBe(1);

    engine.setVolume(-0.5);
    expect(engine.getState().settings.volume).toBe(0);
  });

  it("should handle tempo changes", () => {
    engine.setTempo(1.5);
    expect(engine.getState().settings.tempo).toBe(1.5);
    expect(backend.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  it("should clamp tempo", () => {
    engine.setTempo(5);
    expect(engine.getState().settings.tempo).toBe(4);

    engine.setTempo(0.1);
    expect(engine.getState().settings.tempo).toBe(0.25);
  });

  it("should toggle shuffle", () => {
    expect(engine.getState().queue.shuffled).toBe(false);
    engine.toggleShuffle();
    expect(engine.getState().queue.shuffled).toBe(true);
    engine.toggleShuffle();
    expect(engine.getState().queue.shuffled).toBe(false);
  });

  it("should cycle repeat mode", () => {
    expect(engine.getState().settings.repeat).toBe("off");
    engine.toggleRepeat();
    expect(engine.getState().settings.repeat).toBe("all");
    engine.toggleRepeat();
    expect(engine.getState().settings.repeat).toBe("one");
    engine.toggleRepeat();
    expect(engine.getState().settings.repeat).toBe("off");
  });

  it("should set repeat mode directly and emit settingschange", () => {
    const changes: Array<string | undefined> = [];
    engine.on("settingschange", (e) => changes.push(e.settings.repeat));

    engine.setRepeat("one");
    expect(engine.getState().settings.repeat).toBe("one");
    engine.setRepeat("all");
    expect(engine.getState().settings.repeat).toBe("all");
    expect(changes).toEqual(["one", "all"]);
  });

  it("should set auto play next and emit settingschange", () => {
    const changes: Array<boolean | undefined> = [];
    engine.on("settingschange", (e) =>
      changes.push(e.settings.autoPlayNext),
    );

    engine.setAutoPlayNext(false);
    expect(engine.getState().settings.autoPlayNext).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("should set shuffle state directly", () => {
    engine.setShuffle(true);
    expect(engine.getState().queue.shuffled).toBe(true);
    expect(engine.getState().settings.defaultShuffle).toBe(true);

    engine.setShuffle(true);
    expect(engine.getState().queue.shuffled).toBe(true);

    engine.setShuffle(false);
    expect(engine.getState().queue.shuffled).toBe(false);
    expect(engine.getState().settings.defaultShuffle).toBe(false);
  });

  it("should set shuffle mode and emit settingschange for smart shuffle", () => {
    const changes: Array<boolean | undefined> = [];
    engine.on("settingschange", (e) =>
      changes.push(e.settings.smartShuffle),
    );

    engine.setShuffleMode("smart");
    expect(engine.getState().settings.smartShuffle).toBe(true);
    engine.setShuffleMode("random");
    expect(engine.getState().settings.smartShuffle).toBe(false);

    expect(changes).toEqual([true, false]);
  });

  it("updateSettings should propagate smartShuffle and repeat", () => {
    engine.updateSettings({
      smartShuffle: true,
      repeat: "one",
      autoPlayNext: false,
    });
    const settings = engine.getState().settings;
    expect(settings.smartShuffle).toBe(true);
    expect(settings.repeat).toBe("one");
    expect(settings.autoPlayNext).toBe(false);
  });

  it("does not loop the queue when repeat is off", async () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[2]);
    await engine.play();

    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("c");
  });

  it("loops to the first track on next when repeat is all", async () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[2]);
    await engine.play();

    engine.setRepeat("all");
    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("a");
  });

  it("advances through the queue when repeat is all even with autoPlayNext off", async () => {
    engine.setAutoPlayNext(false);
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    engine.setRepeat("all");
    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("b");
  });

  it("ignores next at the last track when repeat is off even with autoPlayNext off", async () => {
    engine.setAutoPlayNext(false);
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[1]);
    await engine.play();

    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("b");
    expect(engine.getState().state).toBe("playing");
  });

  it("restarts the same track when it ends with repeat one", async () => {
    const endedTrackIds: Array<string | null> = [];
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    engine.setRepeat("one");
    engine.on("trackchange", (e) => {
      if (e.to) endedTrackIds.push(e.to.id);
    });

    (backend.onEnded as ReturnType<typeof jest.fn>).mock.calls.forEach(
      ([cb]) => cb(),
    );

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(endedTrackIds).not.toContain("b");
    expect(backend.seek).toHaveBeenCalledWith(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(backend.play).toHaveBeenCalledTimes(2);
  });

  it("advances to the next track when it ends with repeat all", async () => {
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    engine.setRepeat("all");
    (backend.onEnded as ReturnType<typeof jest.fn>).mock.calls.forEach(
      ([cb]) => cb(),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.getCurrentTrack()?.id).toBe("b");
  });

  it("stops when a track ends with repeat off and autoPlayNext disabled", async () => {
    engine.setAutoPlayNext(false);
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    (backend.onEnded as ReturnType<typeof jest.fn>).mock.calls.forEach(
      ([cb]) => cb(),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(engine.getState().state).toBe("ready");
  });

  it("suppresses the scheduled transition when repeat is one", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 3, shape: "linear" },
      gapless: { enabled: true },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    engine.setRepeat("one");
    now = 179.9;
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(xfadeBackend.load).toHaveBeenCalledTimes(1);
  });

  it("falls back to replaying the only track when it ends with repeat off and autoPlayNext on", async () => {
    const solo = createMockPlaylist(["a"]);
    engine.setPlaylist(solo);
    await engine.load(solo.songs[0]);
    await engine.play();

    (backend.onEnded as ReturnType<typeof jest.fn>).mock.calls.forEach(
      ([cb]) => cb(),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(backend.load).toHaveBeenCalledTimes(2);
  });

  describe("repeat transition timing", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      engine.stop();
      jest.useRealTimers();
    });

    it.each(["setRepeat", "toggleRepeat"] as const)(
      "%s cancels a pending transition when switching to repeat one",
      async (method) => {
        backend.getCurrentTime = () => 179.9;
        const playlist = createMockPlaylist(["a", "b"]);
        await engine.load(playlist.songs[0], playlist);
        await engine.play();
        engine.setRepeat("all");

        await jest.advanceTimersByTimeAsync(100);
        expect(engine.getState().state).toBe("transitioning");

        const stateChange = jest.fn();
        engine.on("statechange", stateChange);
        if (method === "setRepeat") engine.setRepeat("one");
        else engine.toggleRepeat();

        expect(engine.getState().settings.repeat).toBe("one");
        expect(engine.getState().state).toBe("ready");
        expect(stateChange).toHaveBeenCalledWith({
          oldState: "transitioning",
          newState: "ready",
        });
        await jest.advanceTimersByTimeAsync(200);
        expect(engine.getCurrentTrack()?.id).toBe("a");
        expect(backend.load).toHaveBeenCalledTimes(1);

        jest.mocked(backend.onEnded).mock.calls[0][0]();
        await jest.advanceTimersByTimeAsync(0);
        expect(backend.seek).toHaveBeenCalledWith(0);
        expect(engine.getState().state).toBe("playing");

        engine.setRepeat("off");
        await jest.advanceTimersByTimeAsync(200);
        expect(engine.getCurrentTrack()?.id).toBe("b");
        expect(backend.load).toHaveBeenCalledTimes(2);
      },
    );

    it.each(["setRepeat", "toggleRepeat"] as const)(
      "%s leaves an already-started crossfade running",
      async (method) => {
        const source = {
          setOutputGain: jest.fn(),
          getCurrentTime: () => 0,
          dispose: jest.fn(),
        };
        backend.getCurrentTime = () => 179.9;
        backend.createCrossfadeSource = jest.fn().mockResolvedValue(source);
        backend.commitCrossfadeSource = jest.fn();
        backend.setOutputGain = jest.fn();
        engine.setCrossfade(3);
        engine.setRepeat("all");
        const playlist = createMockPlaylist(["a", "b"]);
        await engine.load(playlist.songs[0], playlist);
        await engine.play();

        await jest.advanceTimersByTimeAsync(101);
        expect(engine.getCurrentTrack()?.id).toBe("b");
        expect(backend.commitCrossfadeSource).not.toHaveBeenCalled();

        if (method === "setRepeat") engine.setRepeat("one");
        else engine.toggleRepeat();

        await jest.advanceTimersByTimeAsync(3100);
        expect(source.dispose).not.toHaveBeenCalled();
        expect(backend.commitCrossfadeSource).toHaveBeenCalledWith(source);
        expect(engine.getState().state).toBe("playing");
      },
    );

    it.each([0, 3])(
      "keeps the last track playing through the transition window with crossfade %s",
      async (crossfade) => {
        backend.getCurrentTime = () => 179.9;
        engine.setCrossfade(crossfade);
        const playlist = createMockPlaylist(["a", "b"]);
        await engine.load(playlist.songs[1], playlist);
        await engine.play();

        await jest.advanceTimersByTimeAsync(100);
        expect(engine.getState().state).toBe("playing");
        engine.pause();
        expect(backend.pause).toHaveBeenCalledTimes(1);
        expect(engine.getState().state).toBe("paused");
      },
    );

    it.each([false, true])(
      "becomes ready at the end of the queue with repeat off and autoPlayNext %s",
      async (autoPlayNext) => {
        engine.setAutoPlayNext(autoPlayNext);
        const playlist = createMockPlaylist(["a", "b"]);
        await engine.load(playlist.songs[1], playlist);
        await engine.play();
        const stateChange = jest.fn();
        engine.on("statechange", stateChange);

        jest.mocked(backend.onEnded).mock.calls[0][0]();
        await jest.advanceTimersByTimeAsync(0);

        expect(engine.getCurrentTrack()?.id).toBe("b");
        expect(engine.getState().state).toBe("ready");
        expect(backend.load).toHaveBeenCalledTimes(1);
        expect(stateChange).toHaveBeenCalledWith({
          oldState: "playing",
          newState: "ready",
        });
      },
    );
  });

  it("does not replay the only track when autoPlayNext is off", async () => {
    engine.setAutoPlayNext(false);
    const solo = createMockPlaylist(["a"]);
    engine.setPlaylist(solo);
    await engine.load(solo.songs[0]);
    await engine.play();

    (backend.onEnded as ReturnType<typeof jest.fn>).mock.calls.forEach(
      ([cb]) => cb(),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(engine.getState().state).toBe("ready");
  });

  it("replays the only track when next is pressed with repeat off", async () => {
    const solo = createMockPlaylist(["a"]);
    engine.setPlaylist(solo);
    await engine.load(solo.songs[0]);
    await engine.play();

    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("a");
    expect(backend.load).toHaveBeenCalledTimes(2);
  });

  it("advances past the last track only when repeat is all, never via the single-track fallback", async () => {
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[1]);
    await engine.play();

    await engine.next();

    expect(engine.getCurrentTrack()?.id).toBe("b");
  });

  it("should seek to position", async () => {
    const track = createMockTrack("test-1", 300);
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    engine.seek(60);
    expect(backend.seek).toHaveBeenCalledWith(60);
  });

  it("should handle crossfade settings", () => {
    engine.setCrossfade(3000);
    const scheduler = engine.getScheduler();
    expect(scheduler.getCrossfade().isEnabled()).toBe(true);
  });

  it("should handle gapless settings", () => {
    engine.setGapless(false);
    expect(engine.getState().settings.gaplessPlayback).toBe(false);
  });

  it("should get current track", async () => {
    const track = createMockTrack("test-1");
    const playlist = createMockPlaylist(["test-1"]);
    engine.setPlaylist(playlist);
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.getCurrentTrack()?.id).toBe("test-1");
  });

  it("should update settings", () => {
    engine.updateSettings({
      volume: 0.8,
      pitch: 2,
    });
    expect(engine.getState().settings.volume).toBe(0.8);
    expect(engine.getState().settings.pitch).toBe(2);
  });

  it("applies track ReplayGain by default", async () => {
    const track: Track = {
      ...createMockTrack("rg", 180),
      replayGain: { trackGain: -7.5, albumGain: -5, trackPeak: 0.9 },
    };
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    expect(backend.setReplayGain).toHaveBeenLastCalledWith(-7.5);
  });

  it("prefers album gain when replayGainMode is album", async () => {
    engine.setReplayGainMode("album");
    const track: Track = {
      ...createMockTrack("rg", 180),
      replayGain: { trackGain: -7.5, albumGain: -5 },
    };
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));
    expect(backend.setReplayGain).toHaveBeenLastCalledWith(-5);
  });

  it("adds the ReplayGain preamp and clamps it to the supported range", () => {
    engine.setReplayGainPreampDb(100);
    expect(engine.getState().settings.replayGainPreampDb).toBe(
      MAX_REPLAY_GAIN_DB,
    );

    engine.setReplayGainPreampDb(-100);
    expect(engine.getState().settings.replayGainPreampDb).toBe(
      -MAX_REPLAY_GAIN_DB,
    );
  });

  it("stops applying ReplayGain when disabled", async () => {
    const track: Track = {
      ...createMockTrack("rg", 180),
      replayGain: { trackGain: -7.5 },
    };
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));

    engine.setReplayGainEnabled(false);
    expect(backend.setReplayGain).toHaveBeenLastCalledWith(null);
  });

  it("refreshes the current track when the ReplayGain mode changes", async () => {
    const track: Track = {
      ...createMockTrack("rg", 180),
      replayGain: { trackGain: -7.5, albumGain: -3 },
    };
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));

    engine.setReplayGainMode("album");
    expect(backend.setReplayGain).toHaveBeenLastCalledWith(-3);
  });

  it("should resolve load once ready", async () => {
    const track = createMockTrack("test-1");
    await engine.load(track);
    expect(engine.getState().state).toBe("ready");
  });

  it("should resolve load without rejecting when the backend fails", async () => {
    backend = createMockBackend();
    backend.load = jest.fn().mockRejectedValue(new Error("Failed to load audio"));
    engine = new KomorebiEngine(backend, {
      crossfade: { duration: 0, shape: "linear" },
      gapless: { enabled: true },
      smartShuffle: true,
      autoPlayNext: true,
    });

    const track = createMockTrack("test-1");
    await expect(engine.load(track)).resolves.toBeUndefined();
    expect(engine.getState().state).toBe("error");
  });

  it("should keep playing the next track when advancing", async () => {
    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();
    expect(engine.getState().state).toBe("playing");

    await engine.next();
    expect(engine.getState().state).toBe("playing");
    expect(engine.getCurrentTrack()?.id).toBe("b");
    expect(backend.play).toHaveBeenCalledTimes(2);
  });

  it("should not reject play when the backend fails mid-play", async () => {
    const track = createMockTrack("test-1");
    await engine.load(track);

    backend.play = jest.fn().mockRejectedValue(new Error("Play failed"));
    await expect(engine.play()).resolves.toBeUndefined();
    expect(engine.getState().state).toBe("error");
  });

  it("should not reject play after a failed load", async () => {
    backend = createMockBackend();
    backend.load = jest.fn().mockRejectedValue(new Error("Failed to load audio"));
    engine = new KomorebiEngine(backend, {
      crossfade: { duration: 0, shape: "linear" },
      gapless: { enabled: true },
      smartShuffle: true,
      autoPlayNext: true,
    });

    const track = createMockTrack("test-1");
    engine.load(track);
    await new Promise((r) => setTimeout(r, 10));

    await expect(engine.play()).resolves.toBeUndefined();
    expect(engine.getState().state).toBe("error");
  });

  it("should crossfade to the next track when the backend supports it", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const source = {
      setOutputGain: jest.fn(),
      getCurrentTime: () => 0,
      dispose: jest.fn(),
    };
    const createCrossfadeSource = jest.fn().mockImplementation(() => {
      now = 0;
      return Promise.resolve(source);
    });
    const commitCrossfadeSource = jest.fn();
    const setOutputGain = jest.fn();
    xfadeBackend.createCrossfadeSource = createCrossfadeSource;
    xfadeBackend.commitCrossfadeSource = commitCrossfadeSource;
    xfadeBackend.setOutputGain = setOutputGain;
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 0.05, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 179.99;
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(createCrossfadeSource).toHaveBeenCalledTimes(1);
    expect(createCrossfadeSource).toHaveBeenCalledWith(
      "file:///test/b.mp3",
      expect.anything(),
    );
    expect(commitCrossfadeSource).toHaveBeenCalledWith(source);
    expect(setOutputGain.mock.lastCall?.[0]).toBeCloseTo(0);
    expect(source.setOutputGain.mock.lastCall?.[0]).toBeCloseTo(1);
    expect(engine.getCurrentTrack()?.id).toBe("b");
    expect(engine.getState().state).toBe("playing");
  });

  it("hands duration and playhead to the incoming track when the fade starts", async () => {
    let now = 0;
    let sourceTime = 0;
    let sourceReads = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const source = {
      setOutputGain: jest.fn(),
      getCurrentTime: () => (sourceReads++ === 0 ? 128.85 : sourceTime),
      getDuration: () => 122.5,
      dispose: jest.fn(),
    };
    xfadeBackend.createCrossfadeSource = jest.fn().mockImplementation(() => {
      now = 0;
      return Promise.resolve(source);
    });
    xfadeBackend.commitCrossfadeSource = jest.fn();
    xfadeBackend.setOutputGain = jest.fn();
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 1, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);

    let fadeStartTime: number | null = null;
    engine.on("trackchange", (event) => {
      if (event.to?.id === "b" && fadeStartTime === null) {
        fadeStartTime = engine.getState().currentTime;
      }
    });

    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 179.9;
    await new Promise((resolve) => setTimeout(resolve, 250));
    sourceTime = 4.25;
    await new Promise((resolve) => setTimeout(resolve, 150));

    const midFade = engine.getState();
    expect(xfadeBackend.commitCrossfadeSource).not.toHaveBeenCalled();
    expect(midFade.state).toBe("playing");
    expect(midFade.currentTrack?.id).toBe("b");
    expect(midFade.duration).toBe(122.5);
    expect(midFade.currentTime).toBeCloseTo(4.25);
    expect(fadeStartTime).toBe(0);

    now = 5.5;
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(xfadeBackend.commitCrossfadeSource).toHaveBeenCalledWith(source);
    const committed = engine.getState();
    expect(committed.duration).toBe(180);
    expect(committed.currentTime).toBeCloseTo(5.5);
  });

  it("commits the in-flight crossfade when paused mid-fade", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const source = {
      setOutputGain: jest.fn(),
      getCurrentTime: () => 3,
      getDuration: () => 200,
      dispose: jest.fn(),
    };
    const commitCrossfadeSource = jest.fn();
    xfadeBackend.createCrossfadeSource = jest.fn().mockImplementation(() => {
      now = 0;
      return Promise.resolve(source);
    });
    xfadeBackend.commitCrossfadeSource = commitCrossfadeSource;
    xfadeBackend.setOutputGain = jest.fn();
    xfadeBackend.getDuration = () => 200;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 2, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 179.9;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(commitCrossfadeSource).not.toHaveBeenCalled();
    expect(engine.getState().state).toBe("playing");

    engine.pause();
    expect(engine.getState().state).toBe("paused");
    expect(commitCrossfadeSource).toHaveBeenCalledTimes(1);
    expect(commitCrossfadeSource).toHaveBeenCalledWith(source);
    expect(xfadeBackend.pause).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(commitCrossfadeSource).toHaveBeenCalledTimes(1);
  });

  it("drives the fade for the configured second-valued duration", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const commitCrossfadeSource = jest.fn();
    xfadeBackend.createCrossfadeSource = jest.fn().mockImplementation(() => {
      now = 0;
      return Promise.resolve({
        setOutputGain: jest.fn(),
        getCurrentTime: () => 0,
        dispose: jest.fn(),
      });
    });
    xfadeBackend.commitCrossfadeSource = commitCrossfadeSource;
    xfadeBackend.setOutputGain = jest.fn();
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 0.2, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 179.9;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(commitCrossfadeSource).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(commitCrossfadeSource).toHaveBeenCalledTimes(1);
  });

  it("does not start a crossfade before its window opens", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const createCrossfadeSource = jest.fn();
    xfadeBackend.createCrossfadeSource = createCrossfadeSource;
    xfadeBackend.commitCrossfadeSource = jest.fn();
    xfadeBackend.setOutputGain = jest.fn();
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 3, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 150;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(createCrossfadeSource).not.toHaveBeenCalled();
    expect(engine.getCurrentTrack()?.id).toBe("a");
  });

  it("clamps the crossfade setting to the supported range", () => {
    engine.setCrossfade(999);
    expect((engine as never as { settings: { crossfade: number } }).settings.crossfade).toBe(
      MAX_CROSSFADE_SECONDS,
    );

    engine.setCrossfade(-5);
    expect((engine as never as { settings: { crossfade: number } }).settings.crossfade).toBe(0);
  });

  it("should fall back to a hard switch when crossfade is declined", async () => {
    let now = 0;
    const xfadeBackend = createMockBackend();
    xfadeBackend.getCurrentTime = () => now;
    const createCrossfadeSource = jest.fn().mockResolvedValue(null);
    xfadeBackend.createCrossfadeSource = createCrossfadeSource;
    xfadeBackend.commitCrossfadeSource = jest.fn();
    xfadeBackend.setOutputGain = jest.fn();
    xfadeBackend.getDuration = () => 180;

    engine = new KomorebiEngine(xfadeBackend, {
      crossfade: { duration: 3, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b", "c"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 178;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(createCrossfadeSource).toHaveBeenCalledTimes(1);
    expect(xfadeBackend.load).toHaveBeenCalledTimes(2);
    expect(engine.getCurrentTrack()?.id).toBe("b");
    expect(engine.getState().state).toBe("playing");
  });

  it("should hard switch when the backend cannot crossfade at all", async () => {
    let now = 0;
    const hardBackend = createMockBackend();
    hardBackend.getCurrentTime = () => now;
    hardBackend.getDuration = () => 180;

    engine = new KomorebiEngine(hardBackend, {
      crossfade: { duration: 3, shape: "linear" },
      gapless: { enabled: false },
      smartShuffle: true,
      autoPlayNext: true,
    });
    const playlist = createMockPlaylist(["a", "b"]);
    engine.setPlaylist(playlist);
    await engine.load(playlist.songs[0]);
    await engine.play();

    now = 178;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(hardBackend.load).toHaveBeenCalledTimes(2);
    expect(engine.getCurrentTrack()?.id).toBe("b");
    expect(engine.getState().state).toBe("playing");
  });
});
