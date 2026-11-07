import {
  cardVerificationSchema,
  parseExtractionJson,
  parseJsonObject,
} from './ai.schemas';

describe('AI schemas', () => {
  it('parses a JSON object wrapped in a markdown fence', () => {
    const parsed = parseJsonObject('```json\n{"ok": true}\n```');
    expect(parsed).toEqual({ ok: true });
  });

  it('preserves confirmed zero values and normalizes missing values', () => {
    const extraction = parseExtractionJson(
      JSON.stringify({
        cardName: 'Example Card',
        issuer: 'Example Bank',
        purchaseApr: 'Not explicitly listed',
        balanceTransferApr: null,
        annualFee: 'BDT 0',
        otherFees: '  ',
        welcomeBonus: 'BDT 0 cashback',
        rewardsAndBenefits: null,
        introductoryApr: '0%',
        restrictions: null,
        evidence: {
          annualFee: 'Annual Fee: BDT 0',
          introductoryApr: 'Introductory APR: 0% for 6 months',
        },
      }),
    );

    expect(extraction.purchaseApr).toBeNull();
    expect(extraction.otherFees).toBeNull();
    expect(extraction.annualFee).toBe('BDT 0');
    expect(extraction.welcomeBonus).toBe('BDT 0 cashback');
    expect(extraction.introductoryApr).toBe('0%');
  });

  it('accepts a verification response with malformed field statuses', () => {
    const parsed = cardVerificationSchema.parse({
      overallStatus: 'something-else',
      fields: [{ field: 'annualFee', status: 'unknown' }],
      notes: 'review',
    });

    expect(parsed.overallStatus).toBe('needs_review');
    expect(parsed.fields[0].status).toBe('unverified');
  });

  it('repairs truncated JSON responses when model runs out of output tokens', () => {
    const truncated =
      '{"cardName": "BRAC Platinum", "annualFee": "BDT 5,000", "evidence": {"annualFee": "Annual Fee: BDT 5,000';
    const parsed = parseJsonObject(truncated) as Record<string, unknown>;

    expect(parsed.cardName).toBe('BRAC Platinum');
    expect(parsed.annualFee).toBe('BDT 5,000');
    expect(parsed.evidence).toEqual({ annualFee: 'Annual Fee: BDT 5,000' });
  });

  it('handles multiline strings with literal newlines and trailing commas', () => {
    const rawWithNewlines = `{\n  "cardName": "BRAC Bank Visa Platinum Credit Card",\n  "issuer": "BRAC Bank PLC",\n  "otherFees": "Late Payment Charges: TK. 600\nOver Limit Charges: TK. 1,000",\n}`;
    const parsed = parseExtractionJson(rawWithNewlines);

    expect(parsed.cardName).toBe('BRAC Bank Visa Platinum Credit Card');
    expect(parsed.otherFees).toContain('Late Payment Charges: TK. 600');
    expect(parsed.otherFees).toContain('Over Limit Charges: TK. 1,000');
  });

  it('recovers from trailing colons and incomplete keys at the end', () => {
    const incomplete =
      '{"cardName": "EBL Classic", "issuer": "Eastern Bank PLC", "otherFees": ';
    const parsed = parseExtractionJson(incomplete);

    expect(parsed.cardName).toBe('EBL Classic');
    expect(parsed.issuer).toBe('Eastern Bank PLC');
    expect(parsed.otherFees).toBeNull();
  });
});
