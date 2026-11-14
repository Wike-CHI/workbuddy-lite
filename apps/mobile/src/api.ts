import type { Pairing } from './native';
import type { BridgeEvent, Session } from '../../../packages/core';
export interface Snapshot {
  session: Session;
  epoch: string;
  seq: number;
}
export interface Summary {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
}
export class BridgeApi {
  constructor(private pairing: Pairing) {
    if (
      !Number.isInteger(pairing.port) ||
      pairing.port < 1 ||
      pairing.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(pairing.token)
    )
      throw new Error('INVALID_PAIRING');
  }
  private async request<T>(path: string, body?: object): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.pairing.port}${path}`,
        {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${this.pairing.token}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.code === 'string' ? data.code : 'BRIDGE_ERROR',
        );
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  async status() {
    const status = await this.request<{
      ready: boolean;
      busy: boolean;
      agentError: string;
      instance: string;
    }>('/v1/status');
    if (status.instance !== this.pairing.instance)
      throw new Error('PAIRING_EXPIRED');
    return status;
  }
  sessions() {
    return this.request<{ sessions: Summary[] }>('/v1/sessions');
  }
  session(id: string) {
    return this.request<Snapshot>(`/v1/sessions/${id}`);
  }
  create() {
    return this.request<Snapshot>('/v1/sessions', {});
  }
  events(epoch: string, after: number) {
    return this.request<{
      epoch: string;
      seq: number;
      resync: boolean;
      events: BridgeEvent[];
    }>(`/v1/events?epoch=${encodeURIComponent(epoch)}&after=${after}`);
  }
  send(id: string, text: string, requestId: string) {
    return this.request(`/v1/sessions/${id}/prompt`, { text, requestId });
  }
  cancel(id: string) {
    return this.request(`/v1/sessions/${id}/cancel`, {});
  }
  permission(id: string, permissionId: string, optionId: string | null) {
    return this.request(`/v1/sessions/${id}/permission`, {
      id: permissionId,
      optionId,
    });
  }
  model(id: string, model: string) {
    return this.request(`/v1/sessions/${id}/model`, { model });
  }
}
