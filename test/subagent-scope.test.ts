import { 
  createSubagentScope, 
  getGroupIdForSession, 
  getGroupIdsForSession,
  isSubagentSession, 
  completeSubagentScope,
  DEFAULT_GROUPS
} from '../src/subagent-scope.js';

describe('Subagent Scoped Graphs', () => {
  it('should create isolated scope for subagent', () => {
    const scope = createSubagentScope('parent-123', 'sub-456');
    expect(scope.groupId).toBe('parent-123:sub-456');
    expect(scope.status).toBe('active');
  });
  
  it('should return subagent groupId when subagentId provided', () => {
    createSubagentScope('parent-123', 'sub-456');
    const groupId = getGroupIdForSession('parent-123', 'sub-456');
    expect(groupId).toBe('parent-123:sub-456');
  });
  
  it('should detect subagent sessions', () => {
    expect(isSubagentSession('agent:main:subagent:abc123')).toBe(true);
    expect(isSubagentSession('agent:main')).toBe(false);
  });
  
  it('should complete scope and return summary', async () => {
    createSubagentScope('parent-123', 'sub-789');
    const summary = await completeSubagentScope('sub-789', 'Did some work');
    expect(summary?.summary).toBe('Did some work');
    expect(summary?.status).toBeUndefined(); // Not in SubagentSummary
  });

  it('should auto-detect subagent from sessionId pattern', () => {
    // No explicit subagentId, but sessionId contains :subagent:
    const groupId = getGroupIdForSession('agent:worker-grok:subagent:abc123-def456');
    expect(groupId).toBe('agent:worker-grok:abc123-def456');
  });

  it('should return main groupId for non-subagent sessions in getGroupIdForSession', () => {
    const groupId = getGroupIdForSession('agent:main');
    expect(groupId).toBe('main');
  });

  describe('getGroupIdsForSession', () => {
    it('should return subagent isolated group', () => {
      const groupIds = getGroupIdsForSession('agent:worker-grok:subagent:abc123');
      expect(groupIds).toEqual(['agent:worker-grok:abc123']);
    });

    it('should return known group if session maps to one', () => {
      const groupIds = getGroupIdsForSession('discord:helix');
      expect(groupIds).toEqual(['helix']);
    });

    it('should fall back to default groups for unknown sessions like random discord channels', () => {
      const groupIds = getGroupIdsForSession('discord:1234567890');
      expect(groupIds).toEqual(DEFAULT_GROUPS);
    });

    it('should return default groups for default agent', () => {
      const groupIds = getGroupIdsForSession('agent:default');
      expect(groupIds).toEqual(DEFAULT_GROUPS);
    });
  });
});