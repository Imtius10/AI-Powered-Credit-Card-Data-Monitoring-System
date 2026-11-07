import { Logger } from '@nestjs/common';

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  logger?: Logger;
  shouldRetry?: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | null;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const retries = Math.max(0, options.retries);
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const isLastAttempt = attempt === retries;
      const retryable = options.shouldRetry ? options.shouldRetry(error) : true;

      if (isLastAttempt || !retryable) {
        throw error;
      }

      const retryAfter = options.retryAfterMs?.(error) ?? null;
      const exponentialDelay = options.baseDelayMs * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(
        retryAfter ?? exponentialDelay + jitter,
        maxDelayMs,
      );

      options.logger?.warn(
        `Attempt ${attempt + 1} failed. Retrying in ${delay}ms.`,
      );

      await sleep(delay);
    }
  }

  throw new Error('Retry loop exited unexpectedly');
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, async () => worker()));

  return results;
}
