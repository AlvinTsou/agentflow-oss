/**
 * Semaphore — counting semaphore implementation for limiting concurrency
 * in asynchronous tasks (e.g. parallel forEach execution).
 */
export class Semaphore {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent <= 0) {
      throw new Error("Semaphore: maxConcurrent must be greater than 0");
    }
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.activeCount--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
