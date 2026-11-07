import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Client, Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly connectionString: string;
  private readonly useSsl: boolean;

  constructor(private readonly configService: ConfigService) {
    this.connectionString =
      this.configService.get<string>('DATABASE_URL') ??
      'postgresql://postgres:postgres@localhost:5432/card_monitor';

    this.useSsl =
      this.configService.get<string>('DATABASE_SSL', 'false') === 'true';

    this.pool = new Pool({
      connectionString: this.connectionString,
      max: Number(this.configService.get('DATABASE_POOL_MAX', 5)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: this.useSsl ? { rejectUnauthorized: false } : undefined,
    });

    this.pool.on('error', (error) => {
      this.logger.error(`Unexpected PostgreSQL pool error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureDatabaseAndSchema();
  }

  async ensureDatabaseAndSchema(): Promise<void> {
    await this.ensureDatabaseExists();

    try {
      const tableCheck = await this.pool.query(
        `SELECT to_regclass('public.cards') AS tbl`,
      );
      if (!tableCheck.rows[0]?.tbl) {
        this.logger.log('Database tables not found. Applying schema.sql...');
        const schema = await this.loadSchemaSql();
        if (schema) {
          await this.pool.query(schema);
          this.logger.log('Database schema applied successfully.');
        }
      }
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (
        err?.code === 'ECONNREFUSED' ||
        String(err?.message).includes('ECONNREFUSED')
      ) {
        this.logger.warn(
          'PostgreSQL is not reachable at localhost:5432 (ECONNREFUSED). ' +
            'Start PostgreSQL with `docker compose up -d` or use `pnpm run demo` for mock mode.',
        );
      } else {
        this.logger.warn(
          `Database initialization notice: ${err?.message ?? String(error)}`,
        );
      }
    }
  }

  private async ensureDatabaseExists(): Promise<void> {
    let targetDb = 'card_monitor';
    try {
      const parsed = new URL(this.connectionString);
      targetDb = parsed.pathname.replace(/^\//, '') || 'card_monitor';
      if (!targetDb || targetDb === 'postgres' || targetDb === 'template1') {
        return;
      }
    } catch {
      return;
    }

    const maintenanceDbs = ['postgres', 'template1'];
    for (const mdb of maintenanceDbs) {
      let client: Client | null = null;
      try {
        const adminUrl = new URL(this.connectionString);
        adminUrl.pathname = `/${mdb}`;
        client = new Client({
          connectionString: adminUrl.toString(),
          ssl: this.useSsl ? { rejectUnauthorized: false } : undefined,
        });
        await client.connect();
        const res = await client.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [targetDb],
        );
        if (res.rowCount === 0) {
          this.logger.log(
            `Database "${targetDb}" does not exist. Creating automatically...`,
          );
          const safeName = targetDb.replace(/"/g, '""');
          await client.query(`CREATE DATABASE "${safeName}"`);
          this.logger.log(`Database "${targetDb}" created successfully.`);
        }
        await client.end();
        return;
      } catch {
        if (client) {
          await client.end().catch(() => {});
        }
      }
    }
  }

  private async loadSchemaSql(): Promise<string | null> {
    const candidatePaths = [
      join(__dirname, 'schema.sql'),
      join(__dirname, '..', 'src', 'database', 'schema.sql'),
      join(process.cwd(), 'src', 'database', 'schema.sql'),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        return await readFile(p, 'utf8');
      }
    }
    return null;
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
