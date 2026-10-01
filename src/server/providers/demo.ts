import type { RoomBinding } from '@shared/domain/types';
import type { CommunicationProvider, ExternalChannel, JoinInstruction } from './types';

/**
 * Demo provider: pretends to be a chat platform so the product is explorable without any
 * credentials. It is honest about being a demo in every piece of copy it produces.
 */
export class DemoProvider implements CommunicationProvider {
  readonly kind = 'demo' as const;
  readonly capabilities = {
    identity: false,
    channelListing: true,
    voicePresence: true,
    speakingIndicators: true,
    directVoiceJoin: false,
    deepLinkJoin: false,
    embeddedApp: false,
    chatBridge: false,
    voiceFollow: false,
  };

  async listChannels(): Promise<ExternalChannel[]> {
    return [
      { id: 'demo-cafe', name: 'café-hangout', kind: 'voice', parentName: 'Social' },
      { id: 'demo-hq', name: 'town-square', kind: 'voice', parentName: 'Company' },
      { id: 'demo-eng', name: 'eng-commons', kind: 'voice', parentName: 'Engineering' },
      { id: 'demo-launch', name: 'aurora-war-room', kind: 'voice', parentName: 'Projects' },
      { id: 'demo-events', name: 'lantern-hall-stage', kind: 'stage', parentName: 'Company' },
      { id: 'demo-arcade', name: 'game-night', kind: 'voice', parentName: 'Social' },
      { id: 'demo-design', name: 'design-crit', kind: 'voice', parentName: 'Design' },
      { id: 'demo-general', name: 'general', kind: 'text', parentName: 'Company' },
    ];
  }

  joinInstruction(binding: RoomBinding): JoinInstruction {
    return {
      kind: 'demo',
      label: `Join ${binding.label}`,
      explainer:
        'In a connected workspace this opens the matching Discord voice channel. In demo mode, the conversation is simulated.',
    };
  }
}
