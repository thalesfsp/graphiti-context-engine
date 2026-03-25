import { SubagentScope, SubagentSummary } from './types.js';
export declare const DEFAULT_GROUPS: string[];
export declare function createSubagentScope(parentSessionId: string, subagentId: string): SubagentScope;
export declare function getSubagentScope(subagentId: string): SubagentScope | undefined;
export declare function getGroupIdForSession(sessionId: string, subagentId?: string): string;
export declare function getGroupIdsForSession(sessionId: string, subagentId?: string): string[];
export declare function completeSubagentScope(subagentId: string, summary: string): Promise<SubagentSummary | null>;
export declare function isSubagentSession(sessionId: string): boolean;
//# sourceMappingURL=subagent-scope.d.ts.map