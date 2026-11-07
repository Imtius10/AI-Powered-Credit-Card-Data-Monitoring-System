import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CardsRepository } from '../src/cards/cards.repository';
import { SEED_CARDS } from '../src/cards/seed-cards';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const repository = app.get(CardsRepository);
    await repository.upsertSeedCards(SEED_CARDS);
    console.log(`Seeded ${SEED_CARDS.length} credit cards.`);
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
    console.error('Seeding failed:', error);
  }
  process.exitCode = 1;
});
