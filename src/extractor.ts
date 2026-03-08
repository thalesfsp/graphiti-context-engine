import { Claim } from './types.js';

const EXTRACTOR_VERSION = 'v1.0';

interface PartialClaim {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

interface ExtractionResult {
  claims: PartialClaim[];
}

export async function extractClaims(
  text: string,
  sessionId: string,
  messageId: string,
  authorId?: string
): Promise<ExtractionResult> {
  // For now, use a simple prompt-based extraction
  // In production, this would call OpenClaw's LLM
  
  const prompt = `Extract factual claims from this text as JSON.
Each claim should have: subject, predicate, object, confidence (0-1).
Only extract clear, factual statements. Skip opinions/speculation.

Text: "${text}"

Return JSON: { "claims": [{ "subject": "...", "predicate": "...", "object": "...", "confidence": 0.9 }] }`;

  // TODO: Actually call LLM here
  // TODO: Actually call LLM here
  // For scaffold, return empty claims
  return { claims: [] };
}

export function buildClaimsForIngestion(
  extractionResult: ExtractionResult,
  sessionId: string,
  messageId: string,
  authorId?: string
): Claim[] {
  const now = new Date().toISOString();
  
  return extractionResult.claims.map((c, i) => ({
    claim_id: `${sessionId}-${messageId}-${i}`,
    subject: c.subject,
    predicate: c.predicate,
    object: c.object,
    qualifiers: {},
    confidence: c.confidence,
    status: 'active' as const,
    source_message_id: messageId,
    source_session_id: sessionId,
    source_author_id: authorId,
    extractor_version: EXTRACTOR_VERSION,
    created_at: now,
    updated_at: now,
  }));
}