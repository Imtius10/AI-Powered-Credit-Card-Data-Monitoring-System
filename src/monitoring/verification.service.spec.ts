import { CARD_FIELDS } from '../cards/card.types';
import type {
  AiVerification,
  CardExtraction,
  CardField,
  CardSource,
  FieldVerification,
} from '../cards/card.types';
import { VerificationService } from './verification.service';

const card: CardSource = {
  id: 'card-1',
  slug: 'example-card',
  name: 'Example Visa Card',
  issuer: 'Example Bank PLC',
  sourceUrl: 'https://example.com/card',
  fallbackSourceUrl: null,
  enabled: true,
};

const content = [
  'Card: Example Visa Card',
  'Issuer: Example Bank PLC',
  'Purchase APR: 25%',
  'Annual Fee: BDT 1,500',
  'Late Payment Fee: BDT 500',
  'Note: interest-free period 45 days.',
  'Annual Fee: BDT 0',
  'Introductory APR: 0% for 6 months',
].join('\n');

function extraction(
  overrides: Partial<CardExtraction> = {},
  evidenceOverrides: Partial<Record<CardField, string | null>> = {},
): CardExtraction {
  const values: Partial<CardExtraction> = {
    cardName: 'Example Visa Card',
    issuer: 'Example Bank PLC',
    purchaseApr: '25%',
    balanceTransferApr: null,
    annualFee: 'BDT 1,500',
    otherFees: 'BDT 500',
    welcomeBonus: null,
    rewardsAndBenefits: null,
    introductoryApr: null,
    restrictions: null,
    evidence: {
      cardName: 'Card: Example Visa Card',
      issuer: 'Issuer: Example Bank PLC',
      purchaseApr: 'Purchase APR: 25%',
      annualFee: 'Annual Fee: BDT 1,500',
      otherFees: 'Late Payment Fee: BDT 500',
      ...evidenceOverrides,
    },
    ...overrides,
  };

  return values as CardExtraction;
}

function aiVerification(
  data: CardExtraction,
  overrides: Record<string, Partial<FieldVerification>> = {},
): AiVerification {
  const fields = CARD_FIELDS.map((field) => {
    const base: FieldVerification = {
      field,
      value: data[field],
      evidence: data.evidence[field] ?? null,
      status: data[field] === null ? 'missing' : 'verified',
      reason:
        data[field] === null
          ? 'Not stated in the supplied source.'
          : 'Confirmed against the source.',
    };

    return { ...base, ...overrides[field] };
  });

  return {
    overallStatus: 'verified',
    fields,
    notes: 'Independent pass completed.',
  };
}

describe('VerificationService', () => {
  const service = new VerificationService();

  it('verifies a card when every non-null field has verbatim evidence', () => {
    const data = extraction();
    const result = service.evaluate(card, content, data, aiVerification(data));

    expect(result.status).toBe('verified');
    expect(
      result.fields.filter((field) => field.status === 'verified'),
    ).toHaveLength(5);
    expect(result.notes).toContain('All non-null values');
  });

  it('supports EBL-style cards without a quoted purchase APR', () => {
    const data = extraction(
      {
        purchaseApr: null,
        otherFees: null,
        annualFee: 'Zero Renewal Fee',
        rewardsAndBenefits: 'Reward programme',
      },
      {
        annualFee: 'Zero Renewal Fee',
        rewardsAndBenefits: 'Reward programme',
      },
    );
    const result = service.evaluate(
      card,
      `${content}\nZero Renewal Fee\nReward programme`,
      data,
      aiVerification(data),
    );

    expect(result.status).toBe('verified');
  });

  it('rejects evidence that is not present verbatim in the source', () => {
    const data = extraction({}, { annualFee: 'Annual Fee: BDT 9,999' });
    const result = service.evaluate(card, content, data, aiVerification(data));

    expect(result.status).toBe('pending_review');
    expect(
      result.fields.find((field) => field.field === 'annualFee')?.status,
    ).toBe('unverified');
  });

  it('rejects a value when the verification pass reports a mismatch', () => {
    const data = extraction();
    const result = service.evaluate(
      card,
      content,
      data,
      aiVerification(data, {
        annualFee: {
          status: 'mismatch',
          reason: 'The source lists a different annual fee.',
        },
      }),
    );

    expect(result.status).toBe('pending_review');
    expect(
      result.fields.find((field) => field.field === 'annualFee')?.status,
    ).toBe('mismatch');
  });

  it('requires at least four verified fields before publishing', () => {
    const data = extraction({
      purchaseApr: null,
      otherFees: null,
    });
    const result = service.evaluate(card, content, data, aiVerification(data));

    expect(result.status).toBe('pending_review');
    expect(result.notes).toContain('at least 4');
  });

  it('keeps confirmed zero values instead of treating them as missing', () => {
    const data = extraction(
      {
        purchaseApr: null,
        otherFees: null,
        annualFee: 'BDT 0',
        introductoryApr: '0%',
      },
      {
        annualFee: 'Annual Fee: BDT 0',
        introductoryApr: 'Introductory APR: 0% for 6 months',
      },
    );
    const result = service.evaluate(card, content, data, aiVerification(data));

    expect(result.status).toBe('verified');
    expect(
      result.fields.find((field) => field.field === 'annualFee')?.value,
    ).toBe('BDT 0');
    expect(
      result.fields.find((field) => field.field === 'introductoryApr')?.value,
    ).toBe('0%');
  });
});
