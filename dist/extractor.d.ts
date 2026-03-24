import { Claim, PartialClaim, AgentMessage } from './types.js';
export interface ExtractionResult {
    claims: PartialClaim[];
}
export interface SupersessionResult {
    supersedes: string[];
}
export declare function detectSupersession(_newClaim: PartialClaim, _existingClaims: Claim[]): Promise<SupersessionResult>;
export declare function extractClaims(text: string, _sessionId: string, _messageId: string, _authorId?: string): Promise<ExtractionResult>;
export declare function buildClaimsForIngestion(extractionResult: ExtractionResult, sessionId: string, messageId: string, authorId?: string, message?: AgentMessage): Claim[];
//# sourceMappingURL=extractor.d.ts.map