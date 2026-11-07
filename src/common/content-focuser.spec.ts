import { focusCardContent } from './content-focuser';

describe('focusCardContent', () => {
  it('returns content as-is when below maxChars threshold', () => {
    const text = 'Short official product description with $95 annual fee.';
    const result = focusCardContent(text, 'Sample Card', 'sample-card', {
      maxChars: 1000,
    });
    expect(result).toBe(text);
  });

  it('filters massive documents down to the card-specific sections and financial terms', () => {
    const sampleLargeDocument = `
Home Loan Information
We offer home loans with attractive interest rates starting at 8.5% for construction and purchase.
Auto loans are available up to 40 Lakh BDT with easy repayment tenure.

BRAC Bank Visa Infinite Credit Card Terms
The BRAC Bank Visa Infinite Credit Card offers an exclusive introductory APR of 0% for the first 6 months.
Purchase APR is 19.99% variable, with a balance transfer APR of 18.5%.
Annual fee is BDT 10,000, waived upon spending BDT 500,000 annually.
Welcome bonus includes 10,000 reward points and complimentary airport lounge access worldwide.
Cashback rate is 2% on all international transactions.

Student Savings Account
Open a student account with zero opening balance and free debit card.
Remittance Services
Send money from abroad with zero exchange fee.
`.repeat(10);

    const result = focusCardContent(
      sampleLargeDocument,
      'BRAC Bank Visa Infinite Credit Card',
      'brac-visa-infinite',
      { maxChars: 1500 },
    );

    expect(result.length).toBeLessThanOrEqual(1500);
    expect(result.toLowerCase()).toContain('infinite');
    expect(result.toLowerCase()).toContain('annual fee');
    expect(result.toLowerCase()).not.toContain('home loan');
  });

  it('falls back cleanly if no matching keywords score', () => {
    const genericText = 'General bank terms and conditions.'.repeat(100);
    const result = focusCardContent(genericText, 'Unknown Card', 'unknown', {
      maxChars: 500,
    });
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
