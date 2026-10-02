/**
 * Slack messages as one readable line in a space: Slack's mrkdwn escapes (`<@U1>`, `<#C1|name>`, `<url|text>`,
 * `<!here>`) become plain words, mentions are shown by name and never ping anyone, HTML entities are decoded, and
 * attachments are noted. Pure, so the bridge's tests can pin it down.
 */
import { MAX_CHAT } from '@shared/protocol';
import type { SlackMessage } from './api';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

/** Slack's `ts` ("1700000000.123456") as an ISO time. */
export function slackTime(ts: string | undefined): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(Math.round(n * 1000)).toISOString() : new Date().toISOString();
}

/** One id per Slack message: a `ts` is unique within its channel. */
export const slackMessageId = (channel: string, ts: string) => `slack:${channel}:${ts}`;

/**
 * The text of a message as people would read it. `nameOf` resolves a user id to a display name (unknown ids
 * are shown as "someone").
 */
export function renderSlackText(m: Pick<SlackMessage, 'text' | 'files'>, nameOf: (userId: string) => string | undefined): string {
  let text = (m.text ?? '')
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_s, id: string, label?: string) => `@${label || nameOf(id) || 'someone'}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<#[A-Z0-9]+>/g, '#channel')
    .replace(/<!subteam\^[A-Z0-9]+(?:\|@?([^>]*))?>/g, (_s, label?: string) => `@${label || 'group'}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!date\^\d+\^[^|>]*(?:\|([^>]*))?>/g, (_s, fallback?: string) => fallback ?? '(a date)')
    .replace(/<((?:https?|mailto):[^|>]*)\|([^>]*)>/g, '$2')
    .replace(/<((?:https?|mailto):[^>]*)>/g, '$1')
    .replace(/&(amp|lt|gt);/g, (e) => ENTITIES[e] ?? e)
    .trim();
  const extras = (m.files ?? []).map((f) => `📎 ${f.title || f.name || 'file'}`);
  if (extras.length) text = [text, ...extras].filter(Boolean).join(' ');
  return text.slice(0, MAX_CHAT);
}

/** Message subtypes that are part of the conversation (everything else — joins, huddle threads, pins — isn't). */
const CONVERSATION_SUBTYPES = new Set([undefined, 'file_share', 'thread_broadcast', 'bot_message', 'me_message']);

export const isConversation = (m: Pick<SlackMessage, 'subtype' | 'thread_ts' | 'ts'>) =>
  CONVERSATION_SUBTYPES.has(m.subtype) && (!m.thread_ts || m.thread_ts === m.ts || m.subtype === 'thread_broadcast');
