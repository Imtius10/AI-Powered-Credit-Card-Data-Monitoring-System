import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
} from 'axios';
import * as https from 'https';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { normalizeWhitespace } from '../common/value-normalizer';
import { sha256 } from '../common/hash';
import { withRetry } from '../common/retry';
import { HostRateLimiter } from './host-rate-limiter';
import { RobotsService } from './robots.service';
import type { CachedSource } from './source-cache.repository';
import { SourceCacheRepository } from './source-cache.repository';
import {
  type FetchedSource,
  SourceBlockedError,
  UnsupportedSourceError,
} from './source.types';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly client: AxiosInstance;
  private readonly cacheTtlSeconds: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxContentChars: number;
  private readonly userAgent: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheRepository: SourceCacheRepository,
    private readonly robotsService: RobotsService,
    private readonly rateLimiter: HostRateLimiter,
  ) {
    this.userAgent = this.configService.get<string>(
      'SCRAPER_USER_AGENT',
      'CardDataMonitor/1.0 (+https://example.com/card-data-monitor)',
    );
    this.cacheTtlSeconds = Number(
      this.configService.get('SCRAPER_CACHE_TTL_SECONDS', 900),
    );
    this.maxRetries = Number(this.configService.get('SCRAPER_MAX_RETRIES', 3));
    this.retryBaseDelayMs = Number(
      this.configService.get('SCRAPER_RETRY_BASE_MS', 500),
    );
    this.maxContentChars = Number(
      this.configService.get('SCRAPER_MAX_CONTENT_CHARS') ??
        this.configService.get('SCRAPER_MAX_TEXT_LENGTH', 60000),
    );

    this.client = axios.create({
      timeout: Number(
        this.configService.get('SCRAPER_TIMEOUT_MS') ??
          this.configService.get('SCRAPER_TIMEOUT', 20000),
      ),
      maxRedirects: 10,
      httpsAgent: new https.Agent({
        family: 4,
        rejectUnauthorized:
          this.configService.get<string>(
            'SCRAPER_REJECT_UNAUTHORIZED',
            'false',
          ) === 'true',
      }),
      headers: {
        'User-Agent': this.userAgent,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'keep-alive',
      },
    });
  }

  async fetch(url: string): Promise<FetchedSource> {
    const parsedUrl = new URL(url);
    const cached = await this.cacheRepository.get(url);

    if (cached && this.isFresh(cached)) {
      return this.fromCache(cached, true, false);
    }

    await this.rateLimiter.acquire(parsedUrl.host);

    if (!(await this.robotsService.isAllowed(url))) {
      throw new SourceBlockedError(
        `robots.txt does not allow automated access to ${url}`,
      );
    }

    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }
    if (cached?.lastModified) {
      headers['If-Modified-Since'] = cached.lastModified;
    }

    let response: AxiosResponse<ArrayBuffer>;

    try {
      response = await withRetry(
        async () =>
          this.client.get<ArrayBuffer>(url, {
            responseType: 'arraybuffer',
            headers,
            validateStatus: (status) =>
              (status >= 200 && status < 300) || status === 304,
          }),
        {
          retries: this.maxRetries,
          baseDelayMs: this.retryBaseDelayMs,
          logger: this.logger,
          shouldRetry: (error) => this.isRetryable(error),
          retryAfterMs: (error) => this.parseRetryAfter(error),
        },
      );
    } catch (error: unknown) {
      throw this.classifyError(url, error);
    }

    if (response.status === 304) {
      if (!cached) {
        throw new Error(`Received 304 for ${url} without cached content`);
      }
      return this.fromCache(cached, false, true);
    }

    const buffer = Buffer.from(response.data);
    const contentType = String(response.headers['content-type'] ?? '');
    const parsedContent = await this.extractContent(url, buffer, contentType);

    const contentHash = sha256(parsedContent.content);
    const etag = this.headerValue(response, 'etag');
    const lastModified = this.headerValue(response, 'last-modified');

    await this.cacheRepository.save({
      url,
      etag,
      lastModified,
      contentHash,
      content: parsedContent.content,
      contentType: parsedContent.contentType,
    });

    return {
      url,
      finalUrl: response.request?.res?.responseUrl ?? url,
      statusCode: response.status,
      fetchedAt: new Date().toISOString(),
      title: parsedContent.title,
      contentType: parsedContent.contentType,
      content: parsedContent.content,
      contentHash,
      fromCache: false,
      notModified: false,
    };
  }

  private isFresh(cached: CachedSource): boolean {
    if (this.cacheTtlSeconds <= 0) {
      return false;
    }

    return (
      Date.now() - cached.fetchedAt.getTime() < this.cacheTtlSeconds * 1000
    );
  }

  private fromCache(
    cached: CachedSource,
    fromCache: boolean,
    notModified: boolean,
  ): FetchedSource {
    return {
      url: cached.url,
      finalUrl: cached.url,
      statusCode: notModified ? 304 : 200,
      fetchedAt: cached.fetchedAt.toISOString(),
      title: 'Cached source',
      contentType: cached.contentType ?? '',
      content: cached.content,
      contentHash: cached.contentHash,
      fromCache,
      notModified,
    };
  }

  private async extractContent(
    url: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ title: string; content: string; contentType: string }> {
    const isPdf =
      contentType.includes('application/pdf') ||
      new URL(url).pathname.toLowerCase().endsWith('.pdf') ||
      buffer.subarray(0, 4).toString() === '%PDF';

    if (isPdf) {
      const text = await this.parsePdf(buffer);
      const content = normalizeWhitespace(text).slice(0, this.maxContentChars);

      if (content.length < 50) {
        throw new UnsupportedSourceError(
          `PDF at ${url} did not contain extractable text (it may be a scanned image)`,
        );
      }

      return {
        title: 'Official PDF document',
        content,
        contentType: 'application/pdf',
      };
    }

    const html = buffer.toString('utf8');
    const $ = cheerio.load(html);
    const nextJsContent = this.extractNextJsData($);

    $('script, style, nav, footer, header, noscript, svg, iframe').remove();

    const title = normalizeWhitespace($('title').text()) || 'Untitled page';
    const bodyContent = normalizeWhitespace($('body').text());
    const content = normalizeWhitespace(
      `${bodyContent}\n\n${nextJsContent}`,
    ).slice(0, this.maxContentChars);

    if (content.length < 50) {
      throw new UnsupportedSourceError(
        `Page at ${url} did not contain enough text to extract`,
      );
    }

    return { title, content, contentType: 'text/html' };
  }

  private extractNextJsData($: cheerio.CheerioAPI): string {
    const extractedStrings: string[] = [];

    // 1. Pages Router __NEXT_DATA__
    const nextDataRaw = $('script#__NEXT_DATA__').html();
    if (nextDataRaw) {
      try {
        const parsed = JSON.parse(nextDataRaw) as unknown;
        this.extractStringsFromObject(parsed, extractedStrings);
      } catch {
        // Ignore parse error
      }
    }

    // 2. App Router RSC chunks (self.__next_f.push)
    $('script').each((_, el) => {
      const scriptText = $(el).html() || '';
      if (
        scriptText.includes('self.__next_f.push') ||
        scriptText.includes('__next_f')
      ) {
        const matches = scriptText.match(
          /self\.__next_f\.push\(\[\d+,"(.*?)"\]\)/gs,
        );
        if (matches) {
          for (const match of matches) {
            const innerStrMatch = match.match(
              /self\.__next_f\.push\(\[\d+,"(.*)"\]\)/s,
            );
            if (innerStrMatch && innerStrMatch[1]) {
              try {
                const decoded = JSON.parse(`"${innerStrMatch[1]}"`) as string;
                this.extractReadableTextFromRsc(decoded, extractedStrings);
              } catch {
                const plainWords = innerStrMatch[1]
                  .replace(/\\"/g, '"')
                  .replace(/\\n/g, ' ')
                  .replace(/\\t/g, ' ')
                  .replace(/[\\${}[\]]/g, ' ');
                extractedStrings.push(plainWords);
              }
            }
          }
        }
      }
    });

    return extractedStrings.join(' ');
  }

  private extractStringsFromObject(obj: unknown, results: string[]): void {
    if (!obj) return;
    if (typeof obj === 'string') {
      const trimmed = obj.trim();
      if (trimmed.length > 5 && !/^[a-zA-Z0-9_\-./]+$/.test(trimmed)) {
        results.push(trimmed);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractStringsFromObject(item, results);
      }
      return;
    }
    if (typeof obj === 'object') {
      for (const val of Object.values(obj)) {
        this.extractStringsFromObject(val, results);
      }
    }
  }

  private extractReadableTextFromRsc(
    rscPayload: string,
    results: string[],
  ): void {
    const stringMatches =
      rscPayload.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) ?? [];
    for (const raw of stringMatches) {
      try {
        const str = JSON.parse(raw) as unknown;
        if (
          typeof str === 'string' &&
          str.length > 4 &&
          !str.startsWith('$') &&
          !str.startsWith('/') &&
          !/^[a-f0-9-]{32,}$/i.test(str)
        ) {
          results.push(str);
        }
      } catch {
        // Ignore unparseable snippet
      }
    }
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private headerValue(
    response: AxiosResponse,
    headerName: string,
  ): string | null {
    const value = response.headers[headerName];
    return typeof value === 'string' ? value : null;
  }

  private isRetryable(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      if (status === undefined) {
        return true;
      }

      return status === 429 || status >= 500;
    }

    return false;
  }

  private parseRetryAfter(error: unknown): number | null {
    if (!axios.isAxiosError(error)) {
      return null;
    }

    const header = error.response?.headers['retry-after'];
    if (typeof header !== 'string') {
      return null;
    }

    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const date = Date.parse(header);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
  }

  private classifyError(url: string, error: unknown): Error {
    if (error instanceof SourceBlockedError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;

      if (status === 401 || status === 403 || status === 429) {
        return new SourceBlockedError(
          `Access to ${url} was blocked (HTTP ${status})`,
        );
      }

      if (status !== undefined) {
        return new Error(`Failed to fetch ${url}: HTTP ${status}`);
      }

      return new Error(`Failed to fetch ${url}: ${axiosError.message}`);
    }

    return error instanceof Error
      ? error
      : new Error(`Failed to fetch ${url}: ${String(error)}`);
  }
}
