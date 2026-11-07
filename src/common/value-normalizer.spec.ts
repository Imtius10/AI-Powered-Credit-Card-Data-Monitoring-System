import {
  canonicalizeValue,
  evidenceContainsValue,
  valuesMatch,
} from './value-normalizer';

describe('value-normalizer', () => {
  it('treats equivalent currency formats as equal', () => {
    expect(valuesMatch('TK. 5,000', 'BDT 5,000')).toBe(true);
    expect(valuesMatch('BDT 0', 'BDT 0.00')).toBe(false);
    expect(valuesMatch('25%', '25%')).toBe(true);
  });

  it('canonicalizes currency tokens and spacing', () => {
    expect(canonicalizeValue('TK. 20,000')).toBe('bdt 20000');
    expect(canonicalizeValue('US$ 100')).toBe('usd 100');
    expect(canonicalizeValue('25 %')).toBe('25%');
  });

  it('requires evidence to contain the value or its digits', () => {
    expect(evidenceContainsValue('Annual Fee: BDT 3,000', 'BDT 3,000')).toBe(
      true,
    );
    expect(evidenceContainsValue('Annual Fee: BDT 3,000', 'BDT 5,000')).toBe(
      false,
    );
    expect(evidenceContainsValue('Zero Renewal Fee', 'Zero Renewal Fee')).toBe(
      true,
    );
  });
});
