import * as dns from 'dns';
// Force IPv4 lookup first to prevent ENETUNREACH network errors on restricted local networks
dns.setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All API routes will start with /api
  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
