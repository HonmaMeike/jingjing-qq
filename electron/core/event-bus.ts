import { EventEmitter } from 'node:events';

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(80);
  }

  on<T = unknown>(channel: string, listener: (payload: T) => void): () => void {
    this.emitter.on(channel, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(channel, listener as (...args: unknown[]) => void);
  }

  once<T = unknown>(channel: string, listener: (payload: T) => void): void {
    this.emitter.once(channel, listener as (...args: unknown[]) => void);
  }

  emit<T = unknown>(channel: string, payload: T): void {
    this.emitter.emit(channel, payload);
  }

  removeAll(): void { this.emitter.removeAllListeners(); }
}
