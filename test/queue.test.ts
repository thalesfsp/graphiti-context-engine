import { describe, it, expect, beforeEach } from 'vitest';
import { messageQueue } from '../src/queue.js';

type QueuedMessage = {
  sessionId: string;
  messageId: string;
  message: any;
  timestamp: string;
  isHeartbeat: boolean;
};

describe('MessageQueue', () => {
  beforeEach(() => {
    // Drain queue before each test
    messageQueue.drain();
  });

  it('should enqueue messages', () => {
    const item: QueuedMessage = {
      sessionId: 's1',
      messageId: 'm1',
      message: { role: 'user', content: 'hello' },
      timestamp: 'now',
      isHeartbeat: false
    };
    messageQueue.enqueue(item);
    expect(messageQueue.size()).toBe(1);
  });

  it('should dedupe by sessionId + messageId', () => {
    const item1: QueuedMessage = {
      sessionId: 's1',
      messageId: 'm1',
      message: { content: 'first' },
      timestamp: 'now',
      isHeartbeat: false
    };
    const item2: QueuedMessage = {
      sessionId: 's1',
      messageId: 'm1',
      message: { content: 'diff' },
      timestamp: 'now',
      isHeartbeat: false
    };
    messageQueue.enqueue(item1);
    messageQueue.enqueue(item2);
    expect(messageQueue.size()).toBe(1);
  });

  it('should drain and clear queue', () => {
    messageQueue.enqueue({
      sessionId: 's1',
      messageId: 'm1',
      message: {},
      timestamp: 'now',
      isHeartbeat: false
    });
    messageQueue.enqueue({
      sessionId: 's2',
      messageId: 'm2',
      message: {},
      timestamp: 'now',
      isHeartbeat: false
    });
    const drained = messageQueue.drain();
    expect(drained.length).toBe(2);
    expect(messageQueue.size()).toBe(0);
  });
});