export interface AudioSessionAdapter {
  resume(): void | Promise<void>;
  suspend?(): void | Promise<void>;
  getState?(): string;
  dispose(): void;
}
