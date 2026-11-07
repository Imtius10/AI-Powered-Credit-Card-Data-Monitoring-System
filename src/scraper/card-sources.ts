/**
 * Registry of official bank issuers, official portal URLs,
 * and canonical schedule-of-charges / terms documents.
 */

export interface BankSource {
  issuer: string;
  baseUrl: string;
  scheduleOfChargesUrl?: string;
  robotsTxtUrl: string;
  notes?: string;
}

export const BANK_SOURCES: BankSource[] = [
  {
    issuer: 'BRAC Bank PLC',
    baseUrl: 'https://www.bracbank.com',
    scheduleOfChargesUrl: 'https://www.bracbank.com/en/schedule-of-charges',
    robotsTxtUrl: 'https://www.bracbank.com/robots.txt',
    notes: 'Official retail card product pages and schedules of charges',
  },
  {
    issuer: 'Eastern Bank PLC',
    baseUrl: 'https://www.ebl.com.bd',
    scheduleOfChargesUrl: 'https://www.ebl.com.bd/retail/cards',
    robotsTxtUrl: 'https://www.ebl.com.bd/robots.txt',
    notes: 'Official retail product pages and cards disclosure portal',
  },
  {
    issuer: 'The City Bank PLC',
    baseUrl: 'https://www.citybankplc.com',
    scheduleOfChargesUrl: 'https://www.citybankplc.com/charges',
    robotsTxtUrl: 'https://www.citybankplc.com/robots.txt',
    notes:
      'Official Visa and American Express credit card disclosure documents',
  },
];

export function getBankSourceByIssuer(issuer: string): BankSource | undefined {
  const normalized = issuer.toLowerCase();
  return BANK_SOURCES.find((b) => b.issuer.toLowerCase().includes(normalized));
}
