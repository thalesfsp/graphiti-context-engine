import { AgentMessage } from './types.js';

interface QueuedMessage {
  sessionId: string;
  messageId: string;
  message: AgentMessage;
  timestamp: string;
  isHeartbeat: boolean;
}

class MessageQueue {
  reset(): void {
    this.queue = [];
    this.seen.clear();
  }
  private queue: QueuedMessage[] = [];
  private seen: Set<string> = new Set();

  enqueue(item: QueuedMessage): void {
    // Dedupe by sessionId + messageId
    const key = `${item.sessionId}:${item.messageId}`;
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.queue.push(item);
    }
  }
  
  drain(): QueuedMessage[] {
    const items = [...this.queue];
    this.seen.clear();
    this.queue = [];
    return items;
  }
  
  size(): number {
    return this.queue.length;
  }
}

export const messageQueue = new MessageQueue();
