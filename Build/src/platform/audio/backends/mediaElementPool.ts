import { createLogger, describeError } from "../../../helpers/logger";

const logger = createLogger("mediaElementPool");

const POOL_SIZE = 3;

const GESTURE_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

const unlocked = new WeakSet<HTMLAudioElement>();
const livePools = new Set<MediaElementPool>();
let gestureListenerArmed = false;

const UNLOCK_SRC = buildSilentWavDataUrl();

function buildSilentWavDataUrl(): string {
  const sampleRate = 8000;
  const sampleCount = 8;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint32(34, 1, true);
  writeAscii(36, "data");
  view.setUint32(40, sampleCount, true);

  for (let i = 44; i < bytes.length; i += 1) bytes[i] = 0x80;

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function createElement(): HTMLAudioElement {
  const element = new Audio();
  element.preload = "auto";
  element.volume = 1;
  return element;
}

function unlockElement(element: HTMLAudioElement): void {
  const finishUnlock = (): void => {
    if (element.src !== UNLOCK_SRC) return;
    element.pause();
    element.removeAttribute("src");
    element.load();
  };

  element.muted = false;
  element.src = UNLOCK_SRC;
  element
    .play()
    .then(() => {
      finishUnlock();
      unlocked.add(element);
    })
    .catch((error: unknown) => {
      finishUnlock();
      logger.warn("Media element unlock failed", {
        error: describeError(error),
      });
    });
}

function armGestureUnlock(): void {
  if (gestureListenerArmed || typeof window === "undefined") return;
  gestureListenerArmed = true;

  const onGesture = (): void => unlockMediaElements();
  for (const type of GESTURE_EVENTS) {
    window.addEventListener(type, onGesture, { capture: true });
  }
}

export class MediaElementPool {
  private pool: HTMLAudioElement[] = [];
  private checkedOut = new Set<HTMLAudioElement>();

  constructor() {
    livePools.add(this);
    armGestureUnlock();
  }

  acquire(): HTMLAudioElement {
    this.ensurePool();

    const free = this.pool.find((element) => !this.checkedOut.has(element));
    const element = free ?? createElement();
    if (!free) this.pool.push(element);
    this.checkedOut.add(element);
    return element;
  }

  release(element: HTMLAudioElement): void {
    this.checkedOut.delete(element);
    element.volume = 1;
    element.playbackRate = 1;
  }

  dispose(): void {
    this.checkedOut.clear();
    this.pool = [];
    livePools.delete(this);
  }

  unlockIdle(): void {
    this.ensurePool();
    for (const element of this.pool) {
      if (this.checkedOut.has(element) || unlocked.has(element)) continue;
      unlockElement(element);
    }
  }

  private ensurePool(): void {
    while (this.pool.length < POOL_SIZE) this.pool.push(createElement());
  }
}

export function unlockMediaElements(): void {
  if (typeof Audio === "undefined") return;
  for (const pool of livePools) pool.unlockIdle();
}
