export interface KeyPair {
    publicKey: string;
    privateKey: string;
}

export interface AgentContext {
    agentId: string;
    timestamp: number;
    metadata?: Record<string, any>;
}
