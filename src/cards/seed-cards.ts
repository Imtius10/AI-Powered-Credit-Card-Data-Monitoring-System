export interface SeedCard {
  slug: string;
  name: string;
  issuer: string;
  sourceUrl: string;
  fallbackSourceUrl: string | null;
}

// Canonical Official Bank Disclosure & Product URLs
const BRAC_SOC_PORTAL = 'https://www.bracbank.com/page/schedule-of-charges';
const EBL_CARDS_PORTAL = 'https://www.ebl.com.bd/retail/cards';
const CITY_FEES_PORTAL = 'https://www.citybankplc.com/page/schedule-of-charges';
const UCB_CARDS_PORTAL = 'https://www.ucb.com.bd/cards/';

export const SEED_CARDS: SeedCard[] = [
  {
    slug: 'brac-visa-infinite',
    name: 'BRAC Bank Visa Infinite Credit Card',
    issuer: 'BRAC Bank PLC',
    sourceUrl: 'https://www.bracbank.com/en/retail/card/infinite-card',
    fallbackSourceUrl: BRAC_SOC_PORTAL,
  },
  {
    slug: 'brac-visa-signature',
    name: 'BRAC Bank Visa Signature Credit Card',
    issuer: 'BRAC Bank PLC',
    sourceUrl: 'https://www.bracbank.com/en/retail/card/signature-card',
    fallbackSourceUrl: BRAC_SOC_PORTAL,
  },
  {
    slug: 'brac-visa-platinum',
    name: 'BRAC Bank Visa/Mastercard Platinum Credit Card',
    issuer: 'BRAC Bank PLC',
    sourceUrl: 'https://www.bracbank.com/en/retail/card/platinum-card',
    fallbackSourceUrl: BRAC_SOC_PORTAL,
  },
  {
    slug: 'brac-mastercard-millennial-titanium',
    name: 'BRAC Bank Mastercard Millennial Titanium Credit Card',
    issuer: 'BRAC Bank PLC',
    sourceUrl:
      'https://www.bracbank.com/en/retail/card/millennial-mastercard-titanium',
    fallbackSourceUrl: BRAC_SOC_PORTAL,
  },
  {
    slug: 'ebl-visa-platinum',
    name: 'EBL Visa Platinum Credit Card',
    issuer: 'Eastern Bank PLC',
    sourceUrl:
      'https://www.ebl.com.bd/retail/eblcard/EBL-VISA-Platinum-Credit-Card',
    fallbackSourceUrl: EBL_CARDS_PORTAL,
  },
  {
    slug: 'ebl-visa-gold',
    name: 'EBL Visa Gold Credit Card',
    issuer: 'Eastern Bank PLC',
    sourceUrl:
      'https://www.ebl.com.bd/retail/eblcard/EBL-VISA-Gold-Credit-Card',
    fallbackSourceUrl: EBL_CARDS_PORTAL,
  },
  {
    slug: 'ebl-visa-classic',
    name: 'EBL Visa Classic Credit Card',
    issuer: 'Eastern Bank PLC',
    sourceUrl:
      'https://www.ebl.com.bd/retail/eblcard/EBL-Visa-Classic-Credit-Card',
    fallbackSourceUrl: EBL_CARDS_PORTAL,
  },
  {
    slug: 'city-bank-visa-platinum',
    name: 'City Bank Visa Platinum Credit Card',
    issuer: 'The City Bank PLC',
    sourceUrl: 'https://www.citybankplc.com/p/visa-platinum',
    fallbackSourceUrl: CITY_FEES_PORTAL,
  },
  {
    slug: 'city-bank-visa-infinite',
    name: 'City Bank Visa Infinite Credit Card',
    issuer: 'The City Bank PLC',
    sourceUrl: 'https://www.citybankplc.com/p-ca/visa-infinite',
    fallbackSourceUrl: CITY_FEES_PORTAL,
  },
  {
    slug: 'city-bank-amex-platinum',
    name: 'City Bank American Express Platinum Credit Card',
    issuer: 'The City Bank PLC',
    sourceUrl: 'https://www.citybankplc.com/p-ca/amex-platinum-credit-card',
    fallbackSourceUrl: CITY_FEES_PORTAL,
  },
  {
    slug: 'ucb-visa-platinum',
    name: 'UCB Visa Platinum Card',
    issuer: 'United Commercial Bank PLC',
    sourceUrl:
      'https://www.ucb.com.bd/cards/choose-your-card/visa-platinum-card/',
    fallbackSourceUrl: UCB_CARDS_PORTAL,
  },
];
