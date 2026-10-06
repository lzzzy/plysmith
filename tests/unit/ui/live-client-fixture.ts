import assert from 'node:assert/strict';
import type { PlysmithApplicationClient } from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

const unexpected = async (): Promise<never> =>
  assert.fail('Unexpected live operation');
export const inactiveLiveClient: Pick<
  PlysmithApplicationClient,
  | 'getLiveState'
  | 'getLiveProviderConfiguration'
  | 'observeLiveGame'
  | 'playLiveGame'
  | 'selectLivePosition'
  | 'submitLiveMove'
  | 'actLiveGame'
  | 'refreshLiveGame'
  | 'disconnectLiveGame'
  | 'discardLiveGame'
  | 'saveLiveGame'
  | 'saveLiveProviderConfiguration'
> = {
  getLiveState: async () => ({
    revision: 0,
    configured: false,
    online: false,
    connection: 'unconfigured',
    fairPlayBlocked: false,
    games: [],
  }),
  getLiveProviderConfiguration: async () => ({
    configured: false,
    tokenConfigured: false,
    configurationRevision: null,
    restartRequired: false,
  }),
  observeLiveGame: unexpected,
  playLiveGame: unexpected,
  selectLivePosition: unexpected,
  submitLiveMove: unexpected,
  actLiveGame: unexpected,
  refreshLiveGame: unexpected,
  disconnectLiveGame: unexpected,
  discardLiveGame: unexpected,
  saveLiveGame: unexpected,
  saveLiveProviderConfiguration: unexpected,
};
