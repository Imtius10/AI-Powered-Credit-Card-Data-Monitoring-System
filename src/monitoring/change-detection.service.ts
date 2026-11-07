import { Injectable } from '@nestjs/common';
import { CARD_FIELDS } from '../cards/card.types';
import type {
  CardExtraction,
  CurrentCardData,
  FieldChange,
} from '../cards/card.types';
import { valuesMatch } from '../common/value-normalizer';

@Injectable()
export class ChangeDetectionService {
  compare(
    current: CurrentCardData | null,
    extraction: CardExtraction,
  ): FieldChange[] {
    return CARD_FIELDS.map((field) => {
      const oldValue = current?.[field] ?? null;
      const newValue = extraction[field];
      const status = this.statusFor(current, oldValue, newValue);

      return {
        field,
        oldValue,
        newValue,
        status,
        evidence: extraction.evidence[field] ?? null,
      };
    });
  }

  countPendingChanges(changes: FieldChange[]): number {
    return changes.filter((change) => change.status === 'PENDING_REVIEW')
      .length;
  }

  private statusFor(
    current: CurrentCardData | null,
    oldValue: string | null,
    newValue: string | null,
  ): FieldChange['status'] {
    if (current === null || current.verifiedAt === null) {
      return newValue === null ? 'UNCHANGED' : 'INITIAL';
    }

    return valuesMatch(oldValue, newValue) ? 'UNCHANGED' : 'PENDING_REVIEW';
  }
}
