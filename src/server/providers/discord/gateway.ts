/**
 * Minimal Discord Gateway client used ONLY for voice presence.
 *
 * Intents: GUILDS (1<<0) + GUILD_VOICE_STATES (1<<7). Both are non-privileged. We deliberately do
 * not request GUILD_PRESENCES (online/idle status) — it's privileged, and "is this person online"
 * is exactly the kind of signal Minglewood leaves to the member to share.
 *
 * GUILD_CREATE carries the initial `voice_states`; VOICE_STATE_UPDATE carries changes.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { VoiceStateChange } from '../types';

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = (1 << 0) | (1 << 7);

interface RawVoiceState {
  guild_id?: string;
  channel_id: string | null;
  user_id: string;
  self_mute?: boolean;
  mute?: boolean;
  self_video?: boolean;
}

export class DiscordVoiceGateway extends EventEmitter<{
  voice: [guildId: string, change: VoiceStateChange];
  ready: [];
  error: [err: Error];
}> {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private seq: number | null = null;
  private acked = true;
  private stopped = false;
  private backoff = 1000;

  constructor(
    private readonly token: string,
    private readonly guildIds: () => string[],
    /** Multi-tenant mode: forward every server the bot is in; the app decides which org it is. */
    private readonly acceptUnknown = false,
  ) {
    super();
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
  }

  private connect() {
    const ws = new WebSocket(GATEWAY);
    this.ws = ws;
    ws.on('message', (raw) => this.onMessage(JSON.parse(raw.toString())));
    ws.on('close', (code) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.stopped) return;
      if (code === 4004 || code === 4014) {
        this.emit('error', new Error(`Gateway closed with ${code} (bad token or disallowed intents); not reconnecting.`));
        return;
      }
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
    ws.on('error', (err) => this.emit('error', err));
  }

  private send(op: number, d: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  private onMessage(msg: { op: number; d: unknown; s: number | null; t: string | null }) {
    if (msg.s !== null && msg.s !== undefined) this.seq = msg.s;
    switch (msg.op) {
      case 10: {
        const interval = (msg.d as { heartbeat_interval: number }).heartbeat_interval;
        this.acked = true;
        this.heartbeat = setInterval(() => {
          if (!this.acked) return this.ws?.terminate();
          this.acked = false;
          this.send(1, this.seq);
        }, interval);
        this.send(2, { token: this.token, intents: INTENTS, properties: { os: process.platform, browser: 'minglewood', device: 'minglewood' } });
        break;
      }
      case 11:
        this.acked = true;
        break;
      case 1:
        this.send(1, this.seq);
        break;
      case 7:
      case 9:
        this.ws?.close(4000);
        break;
      case 0:
        this.onDispatch(msg.t!, msg.d);
        break;
    }
  }

  private onDispatch(t: string, d: unknown) {
    const watched = new Set(this.guildIds());
    if (t === 'READY') {
      this.backoff = 1000;
      this.emit('ready');
    } else if (t === 'GUILD_CREATE') {
      const g = d as { id: string; voice_states?: RawVoiceState[] };
      // A just-installed server may not be known yet; the app resolves it on demand.
      if (!watched.has(g.id) && !this.acceptUnknown) return;
      for (const vs of g.voice_states ?? []) this.emit('voice', g.id, toChange(vs));
    } else if (t === 'VOICE_STATE_UPDATE') {
      const vs = d as RawVoiceState;
      if (vs.guild_id && (watched.has(vs.guild_id) || this.acceptUnknown)) this.emit('voice', vs.guild_id, toChange(vs));
    }
  }
}

function toChange(vs: RawVoiceState): VoiceStateChange {
  return {
    externalUserId: vs.user_id,
    channelId: vs.channel_id,
    muted: !!(vs.self_mute || vs.mute),
    video: !!vs.self_video,
  };
}
