import { AgentMessage } from './types.js';
interface QueuedMessage {
    sessionId: string;
    messageId: string;
    message: AgentMessage;
    timestamp: string;
    isHeartbeat: boolean;
}
declare class MessageQueue {
    private queue;
    private seen;
    enqueue(item: QueuedMessage): void;
    drain(): QueuedMessage[];
    size(): number;
}
export declare const messageQueue: MessageQueue;
export {};
//# sourceMappingURL=queue.d.ts.map