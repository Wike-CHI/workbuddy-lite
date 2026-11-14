export interface Message { id: string; role: 'user' | 'assistant' | 'thought' | 'tool'; text: string; toolId?: string; title?: string; status?: string }
export interface Permission { id: string; title: string; input: string; options: { optionId: string; name: string; kind: string }[] }
export interface Session { id: string; acpId: string; cwd: string; title: string; updatedAt: number; running: boolean; messages: Message[]; permissions: Permission[]; models: { modelId: string; name: string }[]; model: string; credits: number | null; error: string; requestIds: string[]; creditLedger?: Record<string, number> }
export interface BridgeEvent { seq: number; type: string; sessionId: string; data: any }
export function emptySession(id: string, cwd: string, acpId: string): Session;
export function applyEvent(session: Session, event: BridgeEvent): Session;
export function eventNeedsSnapshot(epoch: string, after: number, currentEpoch: string, firstSeq: number): boolean;
