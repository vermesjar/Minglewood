import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { wsUrl } from './api';

/** Reconnecting WebSocket with server-clock estimation. */
export class Realtime {
  private ws: WebSocket | null = null;
  private backoff = 500;
  private closed = false;
  private queue: ClientMsg[] = [];
  serverOffset = 0;

  constructor(
    private readonly onMessage: (m: ServerMsg) => void,
    private readonly onStatus: (s: 'online' | 'reconnecting') => void,
  ) {}

  connect() {
    this.closed = false;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.onStatus('online');
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      if (msg.t === 'welcome') this.serverOffset = msg.serverTime - Date.now();
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onStatus('reconnecting');
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 8000);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'move') this.queue.push(m);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
