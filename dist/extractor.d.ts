import { Claim } from './types.js';
interface PartialClaim {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
}
interface ExtractionResult {
    claims: PartialClaim[];
}
export declare function extractClaims(text: string, sessionId: string, messageId: string, authorId?: string): Promise<ExtractionResult>;
export declare function buildClaimsForIngestion(extractionResult: ExtractionResult, sessionId: string, messageId: string, authorId?: string): Claim[];
export {};
//# sourceMappingURL=extractor.d.ts.map