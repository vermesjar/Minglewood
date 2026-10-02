/**
 * On a Slack company, your Slack account *is* your character: what you say is posted as you, your status is yours
 * there too, and your name and picture are the ones people know. So connecting it isn't a setting — it's the step
 * before the world opens. Shown until the grant exists; Slack's own screen does the asking.
 */
import { BRAND } from '@shared/brand';
import { useStore } from '../app/store';

export function ConnectGate() {
  const boot = useStore((s) => s.boot);
  if (!boot || boot.platform !== 'slack' || boot.linked !== 'slack' || boot.slackGranted) return null;
  const first = boot.me.displayName.split(' ')[0];
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-label="Connect your Slack account">
      <div className="gate-card card">
        <p className="kicker">One more step, {first}</p>
        <h2 className="pixel">Connect your Slack account</h2>
        <p>
          {BRAND.name} is your Slack workspace, as a place. Connecting your account makes your character you: what you say
          in a space is posted in its channel <strong>as you</strong>, the status you set here is your Slack status, and
          your name and picture are the ones your team knows.
        </p>
        <ul className="gate-list">
          <li>Posts under your own account — no app tag, in your own Slack history</li>
          <li>Status both ways: set it here or in Slack, the other follows</li>
          <li>Nothing else: no reading your messages, no DMs on your behalf</li>
        </ul>
        <a className="btn slack big" href="/api/slack/me/connect">
          💬 Connect my Slack account
        </a>
        <p className="fineprint">Slack asks you once. Your token stays on {BRAND.name}’s server with your company’s world and is never sent to anyone’s browser.</p>
      </div>
    </div>
  );
}
