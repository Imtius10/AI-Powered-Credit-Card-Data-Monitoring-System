import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface CachedSource {
  url: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  content: string;
  contentType: string | null;
  fetchedAt: Date;
}

interface SourceCacheRow extends QueryResultRow {
  url: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string;
  content: string;
  content_type: string | null;
  fetched_at: Date;
}

@Injectable()
export class SourceCacheRepository {
  constructor(private readonly database: DatabaseService) {}

  async get(url: string): Promise<CachedSource | null> {
    const row = await this.database.queryOne<SourceCacheRow>(
      `SELECT url, etag, last_modified, content_hash, content, content_type, fetched_at
       FROM source_cache
       WHERE url = $1`,
      [url],
    );

    if (!row) {
      return null;
    }

    return {
      url: row.url,
      etag: row.etag,
      lastModified: row.last_modified,
      contentHash: row.content_hash,
      content: row.content,
      contentType: row.content_type,
      fetchedAt: row.fetched_at,
    };
  }

  async save(input: {
    url: string;
    etag: string | null;
    lastModified: string | null;
    contentHash: string;
    content: string;
    contentType: string | null;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO source_cache (
         url,
         etag,
         last_modified,
         content_hash,
         content,
         content_type,
         fetched_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (url) DO UPDATE SET
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified,
         content_hash = EXCLUDED.content_hash,
         content = EXCLUDED.content,
         content_type = EXCLUDED.content_type,
         fetched_at = NOW()`,
      [
        input.url,
        input.etag,
        input.lastModified,
        input.contentHash,
        input.content,
        input.contentType,
      ],
    );
  }
}
