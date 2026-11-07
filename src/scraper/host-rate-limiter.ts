import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../common/retry';

@Injectable()
export class HostRateLimiter {
  private readonly minIntervalMs: number;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {
    this.minIntervalMs = Number(
      this.configService.get('SCRAPER_HOST_MIN_INTERVAL_MS', 1500),
    );
  }

  async acquire(host: string): Promise<void> {
    const previous = this.tails.get(host) ?? Promise.resolve();

    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.tails.set(
      host,
      previous.then(async () => {
        await current;
      }),
    );

    await previous;

    try {
      const lastRequest = this.lastRequestAt.get(host) ?? 0;
      const elapsed = Date.now() - lastRequest;
      const waitMs = Math.max(0, this.minIntervalMs - elapsed);

      if (waitMs > 0) {
        await sleep(waitMs);
      }

      this.lastRequestAt.set(host, Date.now());
    } finally {
      release();
    }
  }
}
