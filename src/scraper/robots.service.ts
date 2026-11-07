import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface RobotsRules {
  allow: string[];
  disallow: string[];
}

interface RobotsCacheEntry {
  expiresAt: number;
  rules: RobotsRules;
}

@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);
  private readonly enabled: boolean;
  private readonly userAgent: string;
  private readonly cache = new Map<string, RobotsCacheEntry>();

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>('SCRAPER_RESPECT_ROBOTS', 'true') !==
      'false';
    this.userAgent = this.configService.get<string>(
      'SCRAPER_USER_AGENT',
      'CardDataMonitor/1.0 (+https://example.com/card-data-monitor)',
    );
  }

  async isAllowed(url: string): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }

    const parsedUrl = new URL(url);
    const cached = this.cache.get(parsedUrl.origin);

    if (cached && cached.expiresAt > Date.now()) {
      return this.pathAllowed(parsedUrl.pathname, cached.rules);
    }

    const rules = await this.loadRules(parsedUrl.origin);
    this.cache.set(parsedUrl.origin, {
      expiresAt: Date.now() + 60 * 60 * 1000,
      rules,
    });

    return this.pathAllowed(parsedUrl.pathname, rules);
  }

  private async loadRules(origin: string): Promise<RobotsRules> {
    try {
      const response = await axios.get<string>(`${origin}/robots.txt`, {
        timeout: 5000,
        responseType: 'text',
        headers: { 'User-Agent': this.userAgent },
        validateStatus: (status) => status >= 200 && status < 300,
      });

      return this.parseRules(response.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not read robots.txt for ${origin}; proceeding with the request: ${message}`,
      );
      return { allow: [], disallow: [] };
    }
  }

  private parseRules(content: string): RobotsRules {
    const rules: RobotsRules = { allow: [], disallow: [] };
    let appliesToUs = false;
    let selectedGroup = false;

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*/, '').trim();
      if (!line) {
        continue;
      }

      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      const directive = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();

      if (directive === 'user-agent') {
        if (selectedGroup && appliesToUs) {
          break;
        }

        appliesToUs =
          value === '*' || value.toLowerCase().includes('carddatamonitor');
        selectedGroup = true;
        continue;
      }

      if (!appliesToUs) {
        continue;
      }

      if (directive === 'allow') {
        rules.allow.push(value);
      } else if (directive === 'disallow') {
        rules.disallow.push(value);
      }
    }

    return rules;
  }

  private pathAllowed(pathname: string, rules: RobotsRules): boolean {
    const matchingDisallow = rules.disallow
      .filter((rule) => rule.length > 0 && pathname.startsWith(rule))
      .sort((left, right) => right.length - left.length)[0];

    const matchingAllow = rules.allow
      .filter((rule) => rule.length > 0 && pathname.startsWith(rule))
      .sort((left, right) => right.length - left.length)[0];

    if (!matchingDisallow) {
      return true;
    }

    if (!matchingAllow) {
      return false;
    }

    return matchingAllow.length >= matchingDisallow.length;
  }
}
