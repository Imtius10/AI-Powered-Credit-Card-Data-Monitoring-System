import { Test, TestingModule } from '@nestjs/testing';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import type {
  CardHistoryResponse,
  CardsResponse,
} from './cards.service';

describe('CardsController', () => {
  let controller: CardsController;
  let service: {
    getCardsResponse: jest.Mock;
    getCardHistory: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getCardsResponse: jest.fn(),
      getCardHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CardsController],
      providers: [
        {
          provide: CardsService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<CardsController>(CardsController);
  });

  it('GET /cards returns cards envelope matching required format', async () => {
    const mockResponse: CardsResponse = {
      success: true,
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
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
      meta: {
        total: 1,
        approved: 1,
        pendingReview: 0,
      },
    };
    service.getCardsResponse.mockResolvedValue(mockResponse);

    const result = await controller.getCards();
    expect(result).toEqual(mockResponse);
    expect(service.getCardsResponse).toHaveBeenCalledTimes(1);
  });

  it('GET /cards/:id/history delegates to cardsService.getCardHistory', async () => {
    const cardId = '11111111-1111-4111-8111-111111111111';
    const mockHistory: CardHistoryResponse = {
      card: {
        id: cardId,
        slug: 'example-card',
        name: 'Example Card',
        issuer: 'Example Bank',
      },
      observations: [],
    };
    service.getCardHistory.mockResolvedValue(mockHistory);

    const result = await controller.getHistory(cardId);
    expect(result).toEqual(mockHistory);
    expect(service.getCardHistory).toHaveBeenCalledWith(cardId);
  });
});
