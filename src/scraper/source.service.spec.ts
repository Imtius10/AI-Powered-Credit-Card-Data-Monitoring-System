import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { CardSource } from '../cards/card.types';
import type { ScraperService } from './scraper.service';
import { SourceService } from './source.service';
import { UnsupportedSourceError } from './source.types';

const card: CardSource = {
  id: 'card-1',
  slug: 'brac-visa-infinite',
  name: 'BRAC Bank Visa Infinite Credit Card',
  issuer: 'BRAC Bank PLC',
  sourceUrl: 'https://example.com/source.pdf',
  fallbackSourceUrl: 'https://example.com/fallback',
  enabled: true,
};

describe('SourceService', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-monitor-fixtures-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function buildService(mode = 'fixtures'): SourceService {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'SOURCE_MODE') {
          return mode;
        }
        if (key === 'FIXTURE_DIR') {
          return directory;
        }
        return fallback;
      }),
    } as unknown as ConfigService;

    return new SourceService(config, {
      fetch: jest.fn(),
    } as unknown as ScraperService);
  }

  it('loads a normalized text fixture with a stable content hash', async () => {
    await writeFile(
      join(directory, 'brac-visa-infinite.txt'),
      'Annual Fee: BDT 20,000\n\nAnnual Interest: 25%\nLate Payment Charge: BDT 1,000',
      'utf8',
    );

    const result = await buildService().getCardContent(card);

    expect(result.mode).toBe('fixture');
    expect(result.content).toBe(
      'Annual Fee: BDT 20,000 Annual Interest: 25% Late Payment Charge: BDT 1,000',
    );
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts visible text from an HTML fixture', async () => {
    await writeFile(
      join(directory, 'brac-visa-infinite.html'),
      '<html><body><nav>menu</nav><main>Annual Fee: BDT 20,000 and Annual Interest: 25 percent</main></body></html>',
      'utf8',
    );

    const result = await buildService().getCardContent(card);

    expect(result.content).toBe(
      'Annual Fee: BDT 20,000 and Annual Interest: 25 percent',
    );
    expect(result.contentType).toBe('text/html');
  });

  it('throws when no fixture exists', async () => {
    await expect(buildService().getCardContent(card)).rejects.toBeInstanceOf(
      UnsupportedSourceError,
    );
  });

  it('combines primary product page and pricing disclosure in live mode', async () => {
    const scraperService = {
      fetch: jest.fn().mockImplementation((url: string) => {
        if (url === card.sourceUrl) {
          return Promise.resolve({
            url,
            finalUrl: url,
            statusCode: 200,
            fetchedAt: '2026-11-07T00:00:00.000Z',
            title: 'Visa Infinite Product Page',
            contentType: 'text/html',
            content: 'Welcome bonus 10000 points and airport lounge access.',
            contentHash: 'hash-primary',
            fromCache: false,
            notModified: false,
          });
        }
        return Promise.resolve({
          url,
          finalUrl: url,
          statusCode: 200,
          fetchedAt: '2026-11-07T00:00:00.000Z',
          title: 'Schedule of Charges',
          contentType: 'text/html',
          content: 'Annual Fee: BDT 20,000. Purchase APR: 25%.',
          contentHash: 'hash-disclosure',
          fromCache: false,
          notModified: false,
        });
      }),
    } as unknown as ScraperService;

    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'SOURCE_MODE') return 'live';
        if (key === 'FIXTURE_DIR') return directory;
        return fallback;
      }),
    } as unknown as ConfigService;

    const service = new SourceService(config, scraperService);
    const result = await service.getCardContent(card);

    expect(result.mode).toBe('live');
    expect(result.content).toContain('=== OFFICIAL PRODUCT PAGE');
    expect(result.content).toContain('Welcome bonus 10000 points');
    expect(result.content).toContain('=== OFFICIAL PRICING & TERMS DISCLOSURE');
    expect(result.content).toContain('Annual Fee: BDT 20,000');
  });
});
