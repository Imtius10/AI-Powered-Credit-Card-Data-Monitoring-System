import { Injectable, NotFoundException } from '@nestjs/common';
import { CARD_FIELDS } from './card.types';
import type { CardSource, CardValues, CurrentCardData } from './card.types';
import { CardsRepository } from './cards.repository';

export interface AprRange {
  min: number | null;
  max: number | null;
}

export interface WelcomeBonusDetails {
  description: string;
  conditions: string | null;
}

export interface RewardCategory {
  category: string;
  rate: string;
}

export interface IntroAprDetails {
  rate: string;
  durationMonths: number | null;
}

export interface FormattedCardData {
  id: string;
  name: string;
  issuer: string;
  purchaseApr: AprRange | null;
  balanceTransferApr: AprRange | null;
  annualFee: number | null;
  welcomeBonus: WelcomeBonusDetails | null;
  rewards: RewardCategory[];
  introApr: IntroAprDetails | null;
  sourceUrl: string;
  lastVerifiedAt: string | null;
}

export interface CardsResponse {
  success: boolean;
  data: FormattedCardData[];
  meta: {
    total: number;
    approved: number;
    pendingReview: number;
  };
}

export interface ApprovedCardResponse {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  sourceUrl: string;
  approvalStatus: 'APPROVED' | 'PENDING_INITIAL_REVIEW';
  approved:
    | (CardValues & {
        sourceUrl: string;
        observationId: string | null;
        verifiedAt: string | null;
        updatedAt: string;
      })
    | null;
}

export interface CardHistoryResponse {
  card: {
    id: string;
    slug: string;
    name: string;
    issuer: string;
  };
  observations: Array<{
    observationId: string;
    observedAt: string;
    sourceUrl: string;
    sourceMode: 'live' | 'fixture';
    verificationStatus: 'verified' | 'pending_review' | 'failed';
    verification: Record<string, unknown>;
    changes: Array<{
      changeId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      status: string;
      evidence: string | null;
    }>;
  }>;
}

function parseAprRange(value: string | null | undefined): AprRange | null {
  if (!value) return null;
  const numbers = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  if (numbers.length === 1) {
    return { min: numbers[0]!, max: numbers[0]! };
  }
  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

function parseAnnualFee(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '');
  if (/no annual fee|free|waived|\$0|\b0\b/i.test(value)) {
    return 0;
  }
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseWelcomeBonus(
  value: string | null | undefined,
): WelcomeBonusDetails | null {
  if (!value) return null;
  const splitMatch = value.split(/(?:after|upon|when you spend|with)\s+/i);
  if (splitMatch.length > 1) {
    return {
      description: splitMatch[0]!.trim(),
      conditions: `After ${value.slice(splitMatch[0]!.length).replace(/^after\s+/i, '').trim()}`,
    };
  }
  return {
    description: value.trim(),
    conditions: null,
  };
}

function parseRewards(value: string | null | undefined): RewardCategory[] {
  if (!value) return [];
  const parts = value.split(/[,;\n•]+/).map((s) => s.trim()).filter(Boolean);
  const rewards: RewardCategory[] = [];

  for (const part of parts) {
    const rateMatch = part.match(
      /\d+(?:\.\d+)?%|\d+\s*(?:points|cashback|miles|skycoins)/i,
    );
    if (rateMatch) {
      const rate = rateMatch[0];
      const category =
        part.replace(rate, '').replace(/[-:]/g, '').trim() ||
        'General Purchases';
      rewards.push({ category, rate });
    } else {
      rewards.push({ category: part, rate: 'Standard' });
    }
  }

  return rewards.length > 0
    ? rewards
    : [{ category: 'All Purchases', rate: value }];
}

function parseIntroApr(
  value: string | null | undefined,
): IntroAprDetails | null {
  if (!value) return null;
  const rateMatch = value.match(/\d+(?:\.\d+)?%/);
  const durationMatch = value.match(/(\d+)\s*(?:months?|mths?)/i);
  return {
    rate: rateMatch ? rateMatch[0] : value,
    durationMonths: durationMatch ? Number(durationMatch[1]) : null,
  };
}

@Injectable()
export class CardsService {
  constructor(private readonly cardsRepository: CardsRepository) {}

  async getCardsResponse(): Promise<CardsResponse> {
    const cards = await this.cardsRepository.getCardsWithCurrent();
    const data = cards.map(({ card, current }) =>
      this.toFormattedCard(card, current),
    );

    const total = cards.length;
    const approved = cards.filter(
      (c) => c.current !== null && c.current.verifiedAt !== null,
    ).length;
    const pendingReview = total - approved;

    return {
      success: true,
      data,
      meta: {
        total,
        approved,
        pendingReview,
      },
    };
  }

  async getApprovedCards(): Promise<ApprovedCardResponse[]> {
    const cards = await this.cardsRepository.getCardsWithCurrent();

    return cards.map(({ card, current }) => ({
      id: card.id,
      slug: card.slug,
      name: card.name,
      issuer: card.issuer,
      sourceUrl: card.sourceUrl,
      approvalStatus: current ? 'APPROVED' : 'PENDING_INITIAL_REVIEW',
      approved: current ? this.toApprovedValues(current) : null,
    }));
  }

  toFormattedCard(
    card: CardSource,
    current: CurrentCardData | null,
  ): FormattedCardData {
    return {
      id: card.id,
      name: current?.cardName ?? card.name,
      issuer: current?.issuer ?? card.issuer,
      purchaseApr: parseAprRange(current?.purchaseApr),
      balanceTransferApr: parseAprRange(current?.balanceTransferApr),
      annualFee: parseAnnualFee(current?.annualFee),
      welcomeBonus: parseWelcomeBonus(current?.welcomeBonus),
      rewards: parseRewards(current?.rewardsAndBenefits),
      introApr: parseIntroApr(current?.introductoryApr),
      sourceUrl: current?.sourceUrl ?? card.sourceUrl,
      lastVerifiedAt: current?.verifiedAt
        ? current.verifiedAt.toISOString()
        : null,
    };
  }

  async getCardHistory(cardId: string): Promise<CardHistoryResponse> {
    const card = await this.cardsRepository.getCardById(cardId);

    if (!card) {
      throw new NotFoundException(`Card ${cardId} was not found`);
    }

    const history = await this.cardsRepository.getHistory(card.id);
    const grouped = new Map<
      string,
      CardHistoryResponse['observations'][number]
    >();

    for (const entry of history) {
      let observation = grouped.get(entry.observationId);

      if (!observation) {
        observation = {
          observationId: entry.observationId,
          observedAt: entry.observedAt,
          sourceUrl: entry.sourceUrl,
          sourceMode: entry.sourceMode,
          verificationStatus: entry.observationStatus,
          verification: entry.verification,
          changes: [],
        };
        grouped.set(entry.observationId, observation);
      }

      observation.changes.push({
        changeId: entry.changeId,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        status: entry.status,
        evidence: entry.evidence,
      });
    }

    return {
      card: {
        id: card.id,
        slug: card.slug,
        name: card.name,
        issuer: card.issuer,
      },
      observations: Array.from(grouped.values()),
    };
  }

  private toApprovedValues(current: CurrentCardData) {
    const values = Object.fromEntries(
      CARD_FIELDS.map((field) => [field, current[field]]),
    ) as CardValues;

    return {
      ...values,
      sourceUrl: current.sourceUrl,
      observationId: current.observationId,
      verifiedAt: current.verifiedAt?.toISOString() ?? null,
      updatedAt: current.updatedAt.toISOString(),
    };
  }
}
