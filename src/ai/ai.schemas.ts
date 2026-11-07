import { z } from 'zod';
import { CARD_FIELDS, type CardExtraction } from '../cards/card.types';

const nullableText = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || /^not explicitly listed$/i.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}, z.string().nullable());

const cardValueShape = Object.fromEntries(
  CARD_FIELDS.map((field) => [field, nullableText]),
) as Record<(typeof CARD_FIELDS)[number], typeof nullableText>;

export const cardExtractionSchema = z.object({
  ...cardValueShape,
  evidence: z
    .record(z.string(), nullableText)
    .optional()
    .transform((value) => value ?? {}),
});

export const verificationFieldSchema = z.object({
  field: z.string(),
  value: nullableText.optional().default(null),
  evidence: nullableText.optional().default(null),
  status: z
    .enum(['verified', 'unverified', 'missing', 'mismatch'])
    .catch('unverified'),
  reason: nullableText.optional().default(null),
});

export const cardVerificationSchema = z.object({
  overallStatus: z.enum(['verified', 'needs_review']).catch('needs_review'),
  fields: z.array(verificationFieldSchema).optional().default([]),
  notes: nullableText.optional().default(null),
});

export function parseExtractionJson(text: string): CardExtraction {
  return cardExtractionSchema.parse(parseJsonObject(text));
}

export function parseVerificationJson(text: string) {
  return cardVerificationSchema.parse(parseJsonObject(text));
}

export function cleanAndSanitizeJson(raw: string): string {
  let str = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const start = str.indexOf('{');
  if (start === -1) {
    return str;
  }
  str = str.slice(start);

  const end = str.lastIndexOf('}');
  if (end !== -1) {
    str = str.slice(0, end + 1);
  }

  // Remove single line comments // ... and multi-line comments /* ... */
  str = str.replace(/\/\/[^\n]*\n/g, '\n');
  str = str.replace(/\/\*[\s\S]*?\*\//g, '');

  let inString = false;
  let escape = false;
  let result = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      result += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      result += char;
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString) {
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else if (char.charCodeAt(0) < 32) {
        // drop illegal control characters in JSON strings
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1');

  return result;
}

export function repairTruncatedJson(jsonStr: string): string {
  let str = cleanAndSanitizeJson(jsonStr);

  const start = str.indexOf('{');
  if (start === -1) {
    return str;
  }
  str = str.slice(start);

  // Check if string literal is unclosed
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
  }

  if (inString) {
    str += '"';
  }

  // Remove dangling keys or colons at the end of truncated string
  // e.g. , "key": or , "key" or :
  str = str.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  str = str.replace(/,\s*"[^"]*"\s*$/, '');
  str = str.replace(/:\s*$/, ': null');
  str = str.replace(/,\s*$/, '');

  // Count unclosed braces and brackets
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') openBraces++;
      if (char === '}') openBraces = Math.max(0, openBraces - 1);
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  while (openBrackets > 0) {
    str += ']';
    openBrackets--;
  }

  while (openBraces > 0) {
    str += '}';
    openBraces--;
  }

  // Remove trailing commas before closing braces/brackets
  str = str.replace(/,\s*([}\]])/g, '$1');

  return str;
}

function fallbackExtractFields(text: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  let foundAny = false;

  for (const field of CARD_FIELDS) {
    const regex = new RegExp(
      `"${field}"\\s*:\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|null|(\\d+(?:\\.\\d+)?))`,
      'i',
    );
    const match = text.match(regex);
    if (match) {
      foundAny = true;
      if (match[1] !== undefined) {
        result[field] = match[1];
      } else if (match[2] !== undefined) {
        result[field] = match[2];
      } else {
        result[field] = null;
      }
    }
  }

  if (!foundAny) {
    return null;
  }

  result.evidence = {};
  return result;
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');

  if (start === -1) {
    throw new Error('AI response did not contain a JSON object');
  }

  // 1. Direct candidate parse
  const end = trimmed.lastIndexOf('}');
  if (end !== -1 && end > start) {
    const directCandidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(directCandidate);
    } catch {
      // Direct parse failed, proceed to sanitize
    }
  }

  // 2. Sanitized parse (fixes unescaped newlines in strings, trailing commas, comments)
  try {
    const sanitized = cleanAndSanitizeJson(trimmed);
    return JSON.parse(sanitized);
  } catch {
    // Sanitized parse failed, proceed to repair
  }

  // 3. Truncated repair
  try {
    const repaired = repairTruncatedJson(trimmed);
    return JSON.parse(repaired);
  } catch {
    // Proceed to fallback regex extractor
  }

  // 4. Fallback field-by-field extractor
  const extractedObject = fallbackExtractFields(text);
  if (extractedObject && Object.keys(extractedObject).length > 0) {
    return extractedObject;
  }

  throw new Error('AI response did not contain a JSON object');
}
