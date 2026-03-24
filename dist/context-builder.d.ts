import { Claim, AgentMessage } from './types.js';
export declare function buildContextAddition(claims: Claim[]): string;
/** Lines matching these patterns are stripped from the query entirely. */
export declare const NOISE_LINE_PATTERNS: RegExp[];
/** Inline patterns removed from within a line (preserving surrounding text). */
export declare const NOISE_INLINE_PATTERNS: RegExp[];
/**
 * Strip noise lines and inline patterns from query text.
 * Returns cleaned text with noise lines removed entirely and
 * inline patterns surgically excised.
 */
export declare function stripNoisePatterns(text: string): string;
export declare function extractQueryFromMessages(messages: AgentMessage[]): string;
//# sourceMappingURL=context-builder.d.ts.map