import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MonitoringService } from '../src/monitoring/monitoring.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const monitoringService = app.get(MonitoringService);
    const summary = await monitoringService.runDailyJob();
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
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
    console.error('Monitoring job failed:', error);
  }
  process.exitCode = 1;
});
