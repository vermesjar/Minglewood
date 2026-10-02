/**
 * Minimal Discord Gateway client: voice presence, the messages of bound text channels, and channel
 * renames/deletions (Discord is the book of record for a space's channels).
 *
 * Intents: GUILDS (1<<0), GUILD_VOICE_STATES (1<<7), GUILD_MESSAGES (1<<9) and MESSAGE_CONTENT (1<<15).
 * Message Content is privileged: it must be switched on for the bot in the Developer Portal. Without it
 * Discord refuses the connection (close 4014); we then reconnect without it and report the chat bridge as
 * one-way instead of losing voice presence. We deliberately never request GUILD_PRESENCES (online/idle):
 * "is this person online" is the member's to share.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { VoiceStateChange } from '../types';
import type { DiscordMessage } from './api';

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const GUILDS = 1 << 0;
const GUILD_VOICE_STATES = 1 << 7;
const GUILD_MESSAGES = 1 << 9;
const MESSAGE_CONTENT = 1 << 15;
const FULL_INTENTS = GUILDS | GUILD_VOICE_STATES | GUILD_MESSAGES | MESSAGE_CONTENT;

/** A message posted in a server text channel. `content` is empty without the Message Content intent. */
export interface GatewayMessage {
  guildId: string;
  message: DiscordMessage;
}

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
  message: [msg: GatewayMessage];
  channel: [guildId: string, channel: { id: string; name?: string; deleted: boolean }];
  ready: [];
  degraded: [reason: 'message-content' | 'messages'];
  error: [err: Error];
}> {
  private intents = FULL_INTENTS;
  /** False when Discord refused the Message Content intent: we still hear messages but not their text. */
  messageContent = true;
  botUserId: string | null = null;
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
      if (code === 4014 && this.intents & MESSAGE_CONTENT) {
        // Message Content isn't enabled for this bot: keep everything else working.
        this.intents &= ~MESSAGE_CONTENT;
        this.messageContent = false;
        this.emit('degraded', 'message-content');
        setTimeout(() => this.connect(), 500);
        return;
      }
      if (code === 4014 && this.intents & GUILD_MESSAGES) {
        this.intents &= ~GUILD_MESSAGES;
        this.emit('degraded', 'messages');
        setTimeout(() => this.connect(), 500);
        return;
      }
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
        this.send(2, { token: this.token, intents: this.intents, properties: { os: process.platform, browser: 'minglewood', device: 'minglewood' } });
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
      this.botUserId = (d as { user?: { id: string } }).user?.id ?? null;
      this.emit('ready');
    } else if (t === 'GUILD_CREATE') {
      const g = d as { id: string; voice_states?: RawVoiceState[] };
      // A just-installed server may not be known yet; the app resolves it on demand.
      if (!watched.has(g.id) && !this.acceptUnknown) return;
      for (const vs of g.voice_states ?? []) this.emit('voice', g.id, toChange(vs));
    } else if (t === 'VOICE_STATE_UPDATE') {
      const vs = d as RawVoiceState;
      if (vs.guild_id && (watched.has(vs.guild_id) || this.acceptUnknown)) this.emit('voice', vs.guild_id, toChange(vs));
    } else if (t === 'MESSAGE_CREATE') {
      const m = d as DiscordMessage & { guild_id?: string };
      if (m.guild_id && (watched.has(m.guild_id) || this.acceptUnknown)) this.emit('message', { guildId: m.guild_id, message: m });
    } else if (t === 'CHANNEL_UPDATE' || t === 'CHANNEL_DELETE') {
      const c = d as { id: string; guild_id?: string; name?: string };
      if (c.guild_id && (watched.has(c.guild_id) || this.acceptUnknown)) this.emit('channel', c.guild_id, { id: c.id, name: c.name, deleted: t === 'CHANNEL_DELETE' });
    }
  }
}

function toChange(vs: RawVoiceState): VoiceStateChange {
  return {
    externalUserId: vs.user_id,
    channelId: vs.channel_id,
    callId: vs.channel_id ?? undefined,
    muted: !!(vs.self_mute || vs.mute),
    video: !!vs.self_video,
  };
}
