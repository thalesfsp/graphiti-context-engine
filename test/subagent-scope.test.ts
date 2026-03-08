import { 
  createSubagentScope, 
  getGroupIdForSession, 
  isSubagentSession, 
  completeSubagentScope 
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
});

  it('should auto-detect subagent from sessionId pattern', () => {
    // No explicit subagentId, but sessionId contains :subagent:
    const groupId = getGroupIdForSession('agent:worker-grok:subagent:abc123-def456');
    expect(groupId).toBe('agent:worker-grok:abc123-def456');
  });

  it('should return main groupId for non-subagent sessions', () => {
    const groupId = getGroupIdForSession('agent:main');
    expect(groupId).toBe('main');
  });
