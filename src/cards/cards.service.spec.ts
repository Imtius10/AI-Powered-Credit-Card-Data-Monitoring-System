import { NotFoundException } from '@nestjs/common';
import type { CardSource, CurrentCardData } from './card.types';
import type { CardsRepository, HistoryEntry } from './cards.repository';
import { CardsService } from './cards.service';

const card: CardSource = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'example-card',
  name: 'Example Card',
  issuer: 'Example Bank',
  sourceUrl: 'https://example.com/card',
  fallbackSourceUrl: null,
  enabled: true,
};

const current: CurrentCardData = {
  cardId: card.id,
  cardName: 'Example Card',
  issuer: 'Example Bank',
  purchaseApr: '25%',
  balanceTransferApr: '10.99%',
  annualFee: 'BDT 1,500',
  otherFees: null,
  welcomeBonus: null,
  rewardsAndBenefits: null,
  introductoryApr: null,
  restrictions: null,
  sourceUrl: card.sourceUrl,
  evidence: { annualFee: 'Annual Fee: BDT 1,500' },
  observationId: 'obs-1',
  verifiedAt: new Date('2026-11-06T10:00:00.000Z'),
  updatedAt: new Date('2026-11-06T10:00:00.000Z'),
};

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    changeId: 'change-1',
    observationId: 'obs-1',
    observedAt: '2026-11-06T10:00:00.000Z',
    observationStatus: 'verified',
    verification: { status: 'verified' },
    sourceUrl: card.sourceUrl,
    sourceMode: 'fixture',
    field: 'annualFee',
    oldValue: null,
    newValue: 'BDT 1,500',
    status: 'INITIAL',
    evidence: 'Annual Fee: BDT 1,500',
    ...overrides,
  };
}

describe('CardsService', () => {
  it('returns approved values and marks cards awaiting initial review', async () => {
    const repository = {
      getCardsWithCurrent: jest.fn().mockResolvedValue([
        { card, current },
        {
          card: {
            ...card,
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'new-card',
          },
          current: null,
        },
      ]),
    } as unknown as CardsRepository;

    const service = new CardsService(repository);
    const result = await service.getApprovedCards();

    expect(result).toHaveLength(2);
    expect(result[0].approvalStatus).toBe('APPROVED');
    expect(result[0].approved?.annualFee).toBe('BDT 1,500');
    expect(result[0].approved?.verifiedAt).toBe('2026-11-06T10:00:00.000Z');
    expect(result[1].approvalStatus).toBe('PENDING_INITIAL_REVIEW');
    expect(result[1].approved).toBeNull();
  });

  it('returns structured cards envelope with parsed fields and meta counts', async () => {
    const repository = {
      getCardsWithCurrent: jest.fn().mockResolvedValue([
        { card, current },
        {
          card: {
            ...card,
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'new-card',
          },
          current: null,
        },
      ]),
    } as unknown as CardsRepository;

    const service = new CardsService(repository);
    const envelope = await service.getCardsResponse();

    expect(envelope.success).toBe(true);
    expect(envelope.meta).toEqual({
      total: 2,
      approved: 1,
      pendingReview: 1,
    });
    expect(envelope.data).toHaveLength(2);
    expect(envelope.data[0]).toEqual({
      id: card.id,
      name: 'Example Card',
      issuer: 'Example Bank',
      purchaseApr: { min: 25, max: 25 },
      balanceTransferApr: { min: 10.99, max: 10.99 },
      annualFee: 1500,
      welcomeBonus: null,
      rewards: [],
      introApr: null,
      sourceUrl: card.sourceUrl,
      lastVerifiedAt: '2026-11-06T10:00:00.000Z',
    });
    expect(envelope.data[1].annualFee).toBeNull();
    expect(envelope.data[1].lastVerifiedAt).toBeNull();
  });

  it('groups change history by observation', async () => {
    const repository = {
      getCardById: jest.fn().mockResolvedValue(card),
      getHistory: jest.fn().mockResolvedValue([
        historyEntry(),
        historyEntry({
          changeId: 'change-2',
          field: 'purchaseApr',
          newValue: '25%',
          evidence: 'Purchase APR: 25%',
        }),
        historyEntry({
          changeId: 'change-3',
          observationId: 'obs-2',
          observedAt: '2026-11-07T10:00:00.000Z',
          oldValue: 'BDT 1,500',
          newValue: 'BDT 2,000',
          status: 'PENDING_REVIEW',
        }),
      ]),
    } as unknown as CardsRepository;

    const service = new CardsService(repository);
    const result = await service.getCardHistory(card.id);

    expect(result.card).toEqual({
      id: card.id,
      slug: card.slug,
      name: card.name,
      issuer: card.issuer,
    });
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].changes).toHaveLength(2);
    expect(result.observations[1].changes[0].status).toBe('PENDING_REVIEW');
  });

  it('throws when the requested card does not exist', async () => {
    const repository = {
      getCardById: jest.fn().mockResolvedValue(null),
    } as unknown as CardsRepository;

    const service = new CardsService(repository);

    await expect(
      service.getCardHistory('33333333-3333-4333-8333-333333333333'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
