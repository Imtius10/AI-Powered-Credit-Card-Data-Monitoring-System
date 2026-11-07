import 'dotenv/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Client, Pool } from 'pg';

async function ensureDatabaseExists(
  connectionString: string,
  useSsl: boolean,
): Promise<void> {
  let targetDb = 'card_monitor';
  try {
    const parsed = new URL(connectionString);
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
      const adminUrl = new URL(connectionString);
      adminUrl.pathname = `/${mdb}`;
      client = new Client({
        connectionString: adminUrl.toString(),
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      });
      await client.connect();
      const res = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [targetDb],
      );
      if (res.rowCount === 0) {
        console.log(`Database "${targetDb}" does not exist. Creating...`);
        const safeName = targetDb.replace(/"/g, '""');
        await client.query(`CREATE DATABASE "${safeName}"`);
        console.log(`Database "${targetDb}" created successfully.`);
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

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/card_monitor';
  const useSsl = process.env.DATABASE_SSL === 'true';

  await ensureDatabaseExists(connectionString, useSsl);

  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const schema = await readFile(
      join(__dirname, '..', 'src', 'database', 'schema.sql'),
      'utf8',
    );
    await pool.query(schema);
    console.log('Database schema is up to date.');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const isConnRefused =
    error &&
    typeof error === 'object' &&
    ('code' in error ||
      String((error as any).message).includes('ECONNREFUSED'));
  if (isConnRefused) {
    console.error(
      '\n❌ Database Connection Error: Could not connect to PostgreSQL on port 5432 (ECONNREFUSED).',
    );
    console.error(
      '   Please ensure PostgreSQL is running, or specify DATABASE_URL in your .env file.',
    );
    console.error(
      '   Example docker command: docker run --name pg-cards -p 5432:5432 -e POSTGRES_PASSWORD=postgres -d postgres:16',
    );
    console.error(
      '   To test the system immediately without a live database, run: pnpm run demo\n',
    );
  } else {
    console.error('Migration failed:', error);
  }
  process.exitCode = 1;
});
