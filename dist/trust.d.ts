import { TrustTier, AgentMessage } from './types.js';
export declare function detectTrustTier(message: AgentMessage): TrustTier;
export declare function getTrustWeight(tier: TrustTier): number;
export declare function compareTrust(a: TrustTier, b: TrustTier): number;
//# sourceMappingURL=trust.d.ts.map