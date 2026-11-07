import { access, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { sha256 } from '../common/hash';
import { normalizeWhitespace } from '../common/value-normalizer';
import type { CardSource } from '../cards/card.types';
import { ScraperService } from './scraper.service';
import type { CardSourceContent } from './source.types';
import { UnsupportedSourceError } from './source.types';

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);
  private readonly mode: string;
  private readonly fixtureDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly scraperService: ScraperService,
  ) {
    this.mode = this.configService.get<string>('SOURCE_MODE', 'auto');
    this.fixtureDir = resolve(
      this.configService.get<string>('FIXTURE_DIR', 'fixtures/sources'),
    );
  }

  async getCardContent(card: CardSource): Promise<CardSourceContent> {
    if (this.mode === 'fixtures') {
      return this.loadFixture(card);
    }

    const errors: string[] = [];
    let primarySource: CardSourceContent | null = null;
    let disclosureSource: CardSourceContent | null = null;

    // 1. Fetch Primary Product Page (Marketing, perks, welcome bonus, rewards)
    try {
      const live = await this.scraperService.fetch(card.sourceUrl);
      primarySource = { ...live, mode: 'live' };
    } catch (error: unknown) {
      errors.push(`Primary: ${this.errorMessage(error)}`);
      this.logger.warn(
        `Primary source failed for ${card.slug}: ${this.errorMessage(error)}`,
      );
    }

    // 2. Fetch Pricing & Terms Disclosure (Purchase APR, annual fee, late/over-limit fees)
    if (card.fallbackSourceUrl && card.fallbackSourceUrl !== card.sourceUrl) {
      try {
        const liveFallback = await this.scraperService.fetch(
          card.fallbackSourceUrl,
        );
        disclosureSource = { ...liveFallback, mode: 'live' };
      } catch (error: unknown) {
        errors.push(`Disclosure: ${this.errorMessage(error)}`);
        this.logger.warn(
          `Disclosure source failed for ${card.slug}: ${this.errorMessage(error)}`,
        );
      }
    }

    // 3. Combine both sources if both succeeded
    if (primarySource && disclosureSource) {
      const combinedContent = [
        `=== OFFICIAL PRODUCT PAGE (${primarySource.url}) ===`,
        primarySource.content,
        '',
        `=== OFFICIAL PRICING & TERMS DISCLOSURE (${disclosureSource.url}) ===`,
        disclosureSource.content,
      ].join('\n');

      const combinedHash = sha256(
        `${primarySource.contentHash}:${disclosureSource.contentHash}`,
      );

      return {
        url: `${primarySource.url} + ${disclosureSource.url}`,
        finalUrl: primarySource.finalUrl,
        statusCode: 200,
        fetchedAt: new Date().toISOString(),
        title: `${primarySource.title} + ${disclosureSource.title}`,
        contentType: 'text/plain',
        content: combinedContent,
        contentHash: combinedHash,
        fromCache: primarySource.fromCache && disclosureSource.fromCache,
        notModified: primarySource.notModified && disclosureSource.notModified,
        mode: 'live',
      };
    }

    // 4. If only one live source succeeded, use it
    if (primarySource) {
      return primarySource;
    }
    if (disclosureSource) {
      return disclosureSource;
    }

    // 5. Fall back to fixture in 'auto' mode
    if (this.mode === 'auto') {
      try {
        this.logger.log(`Using saved official-source fixture for ${card.slug}`);
        return await this.loadFixture(card);
      } catch (error: unknown) {
        errors.push(`Fixture: ${this.errorMessage(error)}`);
      }
    }

    throw new UnsupportedSourceError(
      `No usable source for ${card.slug}. ${errors.join(' | ')}`,
    );
  }

  private async loadFixture(card: CardSource): Promise<CardSourceContent> {
    const txtPath = join(this.fixtureDir, `${card.slug}.txt`);
    const htmlPath = join(this.fixtureDir, `${card.slug}.html`);

    const txtExists = await this.fileExists(txtPath);
    const htmlExists = !txtExists && (await this.fileExists(htmlPath));

    if (!txtExists && !htmlExists) {
      throw new UnsupportedSourceError(
        `No fixture found for ${card.slug} in ${this.fixtureDir}`,
      );
    }

    const filePath = txtExists ? txtPath : htmlPath;
    const raw = await readFile(filePath, 'utf8');

    let content: string;
    let contentType: string;

    if (txtExists) {
      content = normalizeWhitespace(raw);
      contentType = 'text/plain';
    } else {
      const $ = cheerio.load(raw);
      $('script, style, nav, footer, header, noscript, svg, iframe').remove();
      content = normalizeWhitespace($('body').text());
      contentType = 'text/html';
    }

    if (content.length < 50) {
      throw new UnsupportedSourceError(
        `Fixture for ${card.slug} did not contain enough text`,
      );
    }

    this.logger.log(`Using saved official-source fixture for ${card.slug}`);

    return {
      url: card.sourceUrl,
      finalUrl: card.sourceUrl,
      statusCode: 200,
      fetchedAt: new Date().toISOString(),
      title: `${card.name} - saved official source fixture`,
      contentType,
      content,
      contentHash: sha256(content),
      fromCache: false,
      notModified: false,
      mode: 'fixture',
    };
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
