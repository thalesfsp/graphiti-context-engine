import { Claim } from './types.js';
export interface PartialClaim {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
}
export interface ExtractionResult {
    claims: PartialClaim[];
}
export declare function extractClaims(_text: string, _sessionId: string, _messageId: string, _authorId?: string): Promise<ExtractionResult>;
export declare function buildClaimsForIngestion(extractionResult: ExtractionResult, sessionId: string, messageId: string, authorId?: string): Claim[];
//# sourceMappingURL=extractor.d.ts.map