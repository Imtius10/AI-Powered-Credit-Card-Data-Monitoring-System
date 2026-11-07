import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CardsService } from '../src/cards/cards.service';
import type { CardsResponse } from '../src/cards/cards.service';

describe('Cards API (e2e)', () => {
  let app: INestApplication<App>;

  const envelope: CardsResponse = {
    success: true,
    data: [
      {
        id: '522a09c9-ff38-47ec-bced-f6b7435f5827',
        name: 'Example Rewards Card',
        issuer: 'Example Bank',
        purchaseApr: { min: 19.99, max: 29.99 },
        balanceTransferApr: { min: 19.99, max: 29.99 },
        annualFee: 95,
        welcomeBonus: {
          description: 'Earn 50000 bonus points',
          conditions: 'After spending $3000 in 3 months',
        },
        rewards: [
          { category: 'Dining', rate: '3%' },
          { category: 'Travel', rate: '2%' },
        ],
        introApr: { rate: '0%', durationMonths: 12 },
        sourceUrl: 'https://example.com/credit-card',
        lastVerifiedAt: '2026-11-06T10:00:00.000Z',
      },
    ],
    meta: { total: 1, approved: 1, pendingReview: 0 },
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CardsService)
      .useValue({
        getCardsResponse: jest.fn().mockResolvedValue(envelope),
        getCardHistory: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('GET /api/cards returns the structured card envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/cards')
      .expect(200);

    expect(response.body).toEqual(envelope);
    expect(response.body.success).toBe(true);
    expect(response.body.meta).toEqual({
      total: 1,
      approved: 1,
      pendingReview: 0,
    });
    expect(response.body.data[0]).toMatchObject({
      purchaseApr: { min: 19.99, max: 29.99 },
      annualFee: 95,
      introApr: { rate: '0%', durationMonths: 12 },
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
