import {
  MediaElementPool,
  unlockMediaElements,
} from "../src/platform/audio/backends/mediaElementPool";

describe("media element pool", () => {
  let pool: MediaElementPool;

  beforeEach(() => {
    pool = new MediaElementPool();
    jest.spyOn(window.Audio.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    pool.dispose();
    jest.restoreAllMocks();
  });

  it("hands out distinct elements and reuses released ones", () => {
    const first = pool.acquire();
    const second = pool.acquire();

    expect(first).not.toBe(second);

    pool.release(first);
    expect(pool.acquire()).toBe(first);
  });

  it("unlocks idle elements with a silent source but leaves checked-out ones alone", async () => {
    const active = pool.acquire();
    const playSpy = jest.spyOn(window.Audio.prototype, "play");

    unlockMediaElements();
    await Promise.resolve();
    await Promise.resolve();

    expect(playSpy).toHaveBeenCalled();
    expect(playSpy.mock.instances).not.toContain(active);
  });

  it("does not re-unlock an element that was already unlocked", async () => {
    pool.acquire();
    const playSpy = jest.spyOn(window.Audio.prototype, "play");

    unlockMediaElements();
    await Promise.resolve();
    await Promise.resolve();
    const firstPass = playSpy.mock.calls.length;

    unlockMediaElements();
    await Promise.resolve();
    await Promise.resolve();

    expect(playSpy.mock.calls.length).toBe(firstPass);
  });
});
