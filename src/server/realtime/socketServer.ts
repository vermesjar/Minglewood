import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientMsgSchema, type ServerMsg } from '@shared/protocol';
import { getScene } from '@shared/world';
import { sessionFromRequest, verifyToken } from '../auth/session';
import { config } from '../config';
import type { Store } from '../store/store';
import type { OrgHub, HubClient } from './orgHub';
import { TokenBucket } from './rateLimit';

/**
 * WebSocket endpoint at /ws. Authenticates on upgrade (cookie or ?token= for the Discord
 * Activity iframe), then validates every message against the protocol schema before it
 * reaches the hub. The hub never sees unauthenticated or malformed input.
 */
export function attachSockets(server: Server, store: Store, hubs: Map<string, OrgHub>) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.endsWith('/ws')) return;
    // Cookie-authenticated sockets must come from our own origin (or the Discord Activity proxy).
    const origin = req.headers.origin;
    if (origin && !url.searchParams.get('token')) {
      let ok = false;
      try {
        const o = new URL(origin);
        ok = o.host === req.headers.host || o.host === new URL(config.publicUrl).host || o.hostname.endsWith('.discordsays.com');
      } catch {
        ok = false;
      }
      if (!ok) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    const session = sessionFromRequest(req) ?? verifyToken(url.searchParams.get('token'));
    const hub = session && hubs.get(session.orgId);
    if (!session || !hub || !store.member(session.orgId, session.memberId)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, hub, session.memberId));
  });

  function onConnection(ws: WebSocket, hub: OrgHub, memberId: string) {
    const client: HubClient = {
      id: randomUUID(),
      memberId,
      sceneId: null,
      send(msg: ServerMsg) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    const bucket = new TokenBucket(40, 20);
    const chatBucket = new TokenBucket(3, 0.6);
    const knockBucket = new TokenBucket(3, 0.2);
    hub.connect(client);

    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);

    ws.on('message', (raw) => {
      if (!bucket.take()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const res = clientMsgSchema.safeParse(parsed);
      if (!res.success) {
        client.send({ t: 'error', message: 'bad message' });
        return;
      }
      const msg = res.data;
      switch (msg.t) {
        case 'enter':
          if (getScene(msg.sceneId)) hub.enter(memberId, msg.sceneId, 'live', msg.at ?? hub.spotNear(msg.sceneId, msg.near));
          break;
        case 'move':
          if (!hub.move(memberId, msg.path, msg.startedAt)) {
            // Resync the client with authoritative state.
            const a = hub.actor(memberId);
            if (a) client.send({ t: 'updated', memberId, patch: { x: a.x, y: a.y, path: undefined } });
          }
          break;
        case 'sit':
          hub.sit(memberId, msg.objectId);
          break;
        case 'stand':
          hub.stand(memberId);
          break;
        case 'carry':
          hub.carry(memberId, msg.objectId);
          break;
        case 'status':
          hub.setStatus(memberId, msg.status, msg.note);
          break;
        case 'emote':
          hub.emote(memberId, msg.emote, msg.targetId);
          break;
        case 'say':
          if (chatBucket.take()) hub.say(memberId, msg.text);
          break;
        case 'knock':
          if (knockBucket.take()) hub.knock(memberId, msg.targetId, msg.kind);
          else client.send({ t: 'toast', text: 'Easy there — give them a moment to answer.' });
          break;
        case 'knock-reply':
          hub.knockReply(msg.knockId, memberId, msg.reply);
          break;
        case 'avatar':
          hub.setAvatar(memberId, msg.loadout);
          break;
        case 'claim-reward':
          hub.claimReward(memberId, msg.eventId);
          break;
        case 'ping':
          break;
      }
    });

    ws.on('close', () => {
      clearInterval(ping);
      hub.disconnect(client);
    });
  }

  return wss;
}
