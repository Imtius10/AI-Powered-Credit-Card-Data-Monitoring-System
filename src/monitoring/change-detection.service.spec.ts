import type { CardExtraction, CurrentCardData } from '../cards/card.types';
import { ChangeDetectionService } from './change-detection.service';

const extraction: CardExtraction = {
  cardName: 'Example Card',
  issuer: 'Example Bank',
  purchaseApr: '25%',
  balanceTransferApr: null,
  annualFee: 'BDT 2,000',
  otherFees: null,
  welcomeBonus: null,
  rewardsAndBenefits: null,
  introductoryApr: null,
  restrictions: null,
  evidence: {
    annualFee: 'Annual Fee: BDT 2,000',
  },
};

const current: CurrentCardData = {
  cardId: 'card-1',
  cardName: extraction.cardName,
  issuer: extraction.issuer,
  purchaseApr: extraction.purchaseApr,
  balanceTransferApr: extraction.balanceTransferApr,
  annualFee: extraction.annualFee,
  otherFees: extraction.otherFees,
  welcomeBonus: extraction.welcomeBonus,
  rewardsAndBenefits: extraction.rewardsAndBenefits,
  introductoryApr: extraction.introductoryApr,
  restrictions: extraction.restrictions,
  sourceUrl: 'https://example.com',
  evidence: {},
  observationId: 'obs-1',
  verifiedAt: new Date(),
  updatedAt: new Date(),
};

describe('ChangeDetectionService', () => {
  const service = new ChangeDetectionService();

  it('marks populated values as INITIAL when no current card exists', () => {
    const changes = service.compare(null, extraction);

    expect(changes.find((change) => change.field === 'cardName')?.status).toBe(
      'INITIAL',
    );
    expect(
      changes.find((change) => change.field === 'balanceTransferApr')?.status,
    ).toBe('UNCHANGED');
    expect(service.countPendingChanges(changes)).toBe(0);
  });

  it('reports no pending changes when values are equivalent', () => {
    const changes = service.compare(
      { ...current, annualFee: 'TK. 2,000' },
      extraction,
    );

    expect(changes.every((change) => change.status === 'UNCHANGED')).toBe(true);
    expect(service.countPendingChanges(changes)).toBe(0);
  });

  it('flags changed and newly present values for review', () => {
    const changes = service.compare(
      { ...current, annualFee: 'BDT 1,000' },
      { ...extraction, balanceTransferApr: '10.99%' },
    );

    expect(changes.find((change) => change.field === 'annualFee')?.status).toBe(
      'PENDING_REVIEW',
    );
    expect(
      changes.find((change) => change.field === 'balanceTransferApr')?.status,
    ).toBe('PENDING_REVIEW');
    expect(service.countPendingChanges(changes)).toBe(2);
  });
});
