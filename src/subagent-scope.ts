import { SubagentScope, SubagentSummary } from './types.js';

// Track active subagent scopes
const activeScopes = new Map<string, SubagentScope>();

export function createSubagentScope(
  parentSessionId: string,
  subagentId: string
): SubagentScope {
  const scope: SubagentScope = {
    parentSessionId,
    subagentId,
    groupId: `${parentSessionId}:${subagentId}`,
    startedAt: new Date().toISOString(),
    status: 'active',
  };
  activeScopes.set(subagentId, scope);
  return scope;
}

export function getSubagentScope(subagentId: string): SubagentScope | undefined {
  return activeScopes.get(subagentId);
}

export function getGroupIdForSession(sessionId: string, subagentId?: string): string {
  if (subagentId) {
    const scope = activeScopes.get(subagentId);
    if (scope) return scope.groupId;
    const parts = sessionId.split(':');
    return `${parts[2] || 'default'}:${subagentId}`;
  }
  // Use session-based grouping for main agent (match current engine logic)
  const parts = sessionId.split(':');
  return parts[2] || 'default';
}

export async function completeSubagentScope(
  subagentId: string,
  summary: string
): Promise<SubagentSummary | null> {
  const scope = activeScopes.get(subagentId);
  if (!scope) return null;
  
  scope.status = 'completed';
  activeScopes.delete(subagentId);
  
  return {
    subagentId,
    parentSessionId: scope.parentSessionId,
    summary,
    claimCount: 0, // Would query actual count
    startedAt: scope.startedAt,
    completedAt: new Date().toISOString(),
  };
}

export function isSubagentSession(sessionId: string): boolean {
  return sessionId.includes(':subagent:');
}
