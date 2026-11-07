import { Module } from '@nestjs/common';
import { HostRateLimiter } from './host-rate-limiter';
import { RobotsService } from './robots.service';
import { ScraperService } from './scraper.service';
import { SourceCacheRepository } from './source-cache.repository';
import { SourceService } from './source.service';

@Module({
  providers: [
    HostRateLimiter,
    RobotsService,
    SourceCacheRepository,
    ScraperService,
    SourceService,
  ],
  exports: [ScraperService, SourceService],
})
export class ScraperModule {}
