/**
 * The bot's scopes, each for one feature, and what breaks without it. docs/slack.md explains every one; the
 * admin console's readiness check compares this list with what the workspace actually granted.
 */
export interface ScopeNeed {
  scope: string;
  neededFor: string;
}

export const SLACK_BOT_SCOPE_NEEDS: ScopeNeed[] = [
  { scope: 'channels:read', neededFor: 'List public channels to link spaces to; follow renames and archives' },
  { scope: 'groups:read', neededFor: 'List private channels the app was invited to' },
  { scope: 'channels:history', neededFor: 'A space’s conversation and history from its public channel; which channel a huddle is in' },
  { scope: 'groups:history', neededFor: 'The same for private channels' },
  { scope: 'users:read', neededFor: 'Names and pictures, statuses, huddle state, who is a workspace admin' },
  { scope: 'users:read.email', neededFor: 'Recognise the same person across sign-in methods' },
  { scope: 'dnd:read', neededFor: 'Do Not Disturb → Focused' },
  { scope: 'chat:write', neededFor: 'Post what’s said in a space to its channel; the daily note; knock DMs' },
  { scope: 'chat:write.customize', neededFor: 'Post under each person’s own name and picture' },
  { scope: 'channels:manage', neededFor: 'One-click “create a channel for every space”' },
  { scope: 'channels:join', neededFor: 'Join the public channels spaces are linked to, so their messages and huddles reach the world' },
  { scope: 'im:write', neededFor: 'Knock DMs' },
  { scope: 'commands', neededFor: '/minglewood' },
  { scope: 'links:read', neededFor: 'Notice Minglewood links in messages' },
  { scope: 'links:write', neededFor: 'Preview them with who’s there' },
  { scope: 'team:read', neededFor: 'The workspace’s name when connecting' },
];

export const SLACK_BOT_SCOPES = SLACK_BOT_SCOPE_NEEDS.map((s) => s.scope);
