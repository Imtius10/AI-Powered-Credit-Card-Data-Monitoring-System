import { Injectable } from '@nestjs/common';
import { CARD_FIELDS } from '../cards/card.types';
import type {
  AiVerification,
  CardExtraction,
  CardField,
  CardSource,
  FieldVerification,
  VerificationResult,
} from '../cards/card.types';
import {
  evidenceContainsValue,
  normalizeForComparison,
} from '../common/value-normalizer';

const CORE_FIELDS: CardField[] = ['cardName', 'issuer'];

@Injectable()
export class VerificationService {
  evaluate(
    _card: CardSource,
    content: string,
    extraction: CardExtraction,
    aiVerification: AiVerification,
  ): VerificationResult {
    const normalizedContent = normalizeForComparison(content);
    const aiFields = new Map(
      aiVerification.fields.map((field) => [field.field, field]),
    );

    const fields = CARD_FIELDS.map((field) =>
      this.verifyField(
        field,
        content,
        normalizedContent,
        extraction,
        aiFields.get(field),
      ),
    );

    const presentFields = fields.filter((field) => field.value !== null);
    const verifiedFields = fields.filter(
      (field) => field.status === 'verified',
    );
    const hasMismatch = fields.some((field) => field.status === 'mismatch');
    const allPresentVerified = presentFields.every(
      (field) => field.status === 'verified',
    );
    const coreFieldsVerified = CORE_FIELDS.every(
      (field) =>
        fields.find((candidate) => candidate.field === field)?.status ===
        'verified',
    );
    const enoughEvidence = verifiedFields.length >= 4;

    const verified =
      !hasMismatch &&
      presentFields.length > 0 &&
      allPresentVerified &&
      coreFieldsVerified &&
      enoughEvidence &&
      aiVerification.overallStatus === 'verified';

    const deterministicNote = verified
      ? 'All non-null values have verbatim source evidence and were confirmed by the verification pass.'
      : this.buildFailureNote(
          fields,
          presentFields.length,
          verifiedFields.length,
          coreFieldsVerified,
          aiVerification,
        );

    return {
      status: verified ? 'verified' : 'pending_review',
      fields,
      notes: [aiVerification.notes, deterministicNote]
        .filter(Boolean)
        .join(' '),
    };
  }

  private verifyField(
    field: CardField,
    content: string,
    normalizedContent: string,
    extraction: CardExtraction,
    aiField: FieldVerification | undefined,
  ): FieldVerification {
    const value = extraction[field];
    const evidence = extraction.evidence[field] ?? aiField?.evidence ?? null;

    if (value === null) {
      if (aiField?.status === 'mismatch') {
        return {
          field,
          value,
          evidence,
          status: 'mismatch',
          reason:
            aiField.reason ??
            'The content contradicts the missing extracted value.',
        };
      }

      return {
        field,
        value,
        evidence,
        status: 'missing',
        reason: aiField?.reason ?? 'Not stated in the supplied source.',
      };
    }

    if (!evidence) {
      return {
        field,
        value,
        evidence: null,
        status: 'unverified',
        reason: 'No source evidence was supplied for this value.',
      };
    }

    const normalizedEvidence = normalizeForComparison(evidence);

    if (!normalizedContent.includes(normalizedEvidence)) {
      return {
        field,
        value,
        evidence,
        status: 'unverified',
        reason: 'The evidence was not found verbatim in the source content.',
      };
    }

    if (!evidenceContainsValue(evidence, value)) {
      return {
        field,
        value,
        evidence,
        status: 'unverified',
        reason:
          'The evidence does not contain the numeric value or wording of the extracted value.',
      };
    }

    if (aiField?.status === 'mismatch') {
      return {
        field,
        value,
        evidence,
        status: 'mismatch',
        reason:
          aiField.reason ?? 'The verification pass found a contradiction.',
      };
    }

    if (aiField?.status !== 'verified') {
      return {
        field,
        value,
        evidence,
        status: 'unverified',
        reason:
          aiField?.reason ??
          'The independent verification pass did not confirm this value.',
      };
    }

    return {
      field,
      value,
      evidence,
      status: 'verified',
      reason: aiField.reason ?? 'Confirmed against verbatim source evidence.',
    };
  }

  private buildFailureNote(
    fields: FieldVerification[],
    presentCount: number,
    verifiedCount: number,
    coreFieldsVerified: boolean,
    aiVerification: AiVerification,
  ): string {
    if (presentCount === 0) {
      return 'No verified values were extracted from the source.';
    }

    if (!coreFieldsVerified) {
      return 'One or more core identity fields (card name, issuer) could not be verified.';
    }

    if (verifiedCount < 4) {
      return `Only ${verifiedCount} field(s) could be verified; at least 4 are required before publishing.`;
    }

    if (aiVerification.overallStatus !== 'verified') {
      return 'The independent verification pass requested review.';
    }

    const problematic = fields
      .filter(
        (field) => field.status === 'mismatch' || field.status === 'unverified',
      )
      .map((field) => field.field);

    return `Review required for: ${problematic.join(', ')}.`;
  }
}
