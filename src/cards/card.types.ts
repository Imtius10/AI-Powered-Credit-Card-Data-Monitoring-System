export const CARD_FIELDS = [
  'cardName',
  'issuer',
  'purchaseApr',
  'balanceTransferApr',
  'annualFee',
  'otherFees',
  'welcomeBonus',
  'rewardsAndBenefits',
  'introductoryApr',
  'restrictions',
] as const;

export type CardField = (typeof CARD_FIELDS)[number];

export type CardValues = Record<CardField, string | null>;

export type EvidenceMap = Partial<Record<CardField, string | null>>;

export interface CardExtraction extends CardValues {
  evidence: EvidenceMap;
}

export type ChangeStatus =
  'INITIAL' | 'UNCHANGED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface CardSource {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  sourceUrl: string;
  fallbackSourceUrl: string | null;
  enabled: boolean;
}

export interface CurrentCardData extends CardValues {
  cardId: string;
  sourceUrl: string;
  evidence: EvidenceMap;
  observationId: string | null;
  verifiedAt: Date | null;
  updatedAt: Date;
}

export interface FieldChange {
  field: CardField;
  oldValue: string | null;
  newValue: string | null;
  status: ChangeStatus;
  evidence: string | null;
}

export type FieldVerificationStatus =
  'verified' | 'unverified' | 'missing' | 'mismatch';

export interface FieldVerification {
  field: string;
  value: string | null;
  evidence: string | null;
  status: FieldVerificationStatus;
  reason: string | null;
}

export interface AiVerification {
  overallStatus: 'verified' | 'needs_review';
  fields: FieldVerification[];
  notes: string | null;
}

export interface VerificationResult {
  status: 'verified' | 'pending_review';
  fields: FieldVerification[];
  notes: string | null;
}

export interface AiUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface ObservationInput {
  cardId: string;
  sourceUrl: string;
  sourceMode: 'live' | 'fixture';
  sourceContentHash: string;
  extraction: CardExtraction;
  verification: {
    status: 'verified' | 'pending_review';
    fields: FieldVerification[];
    notes: string | null;
    ai: AiVerification;
    usage: {
      extraction: AiUsage;
      verification: AiUsage;
    };
  };
  status: 'verified' | 'pending_review' | 'failed';
  aiModel: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  error: string | null;
}

export interface CardProcessingResult {
  cardId: string;
  slug: string;
  status: 'verified' | 'pending_review' | 'unchanged_source' | 'failed';
  changesDetected: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  error?: string;
}

export interface JobSummary {
  jobRunId: string;
  status: 'succeeded' | 'partial_failure' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cardsProcessed: number;
  cardsFailed: number;
  changesDetected: number;
  cardsVerified: number;
  cardsPendingReview: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  results: CardProcessingResult[];
}
