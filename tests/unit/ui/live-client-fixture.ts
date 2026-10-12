import assert from 'node:assert/strict';
import type { PlysmithApplicationClient } from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

const unexpected = async (): Promise<never> =>
  assert.fail('Unexpected live operation');
export const inactiveLiveClient: Pick<
  PlysmithApplicationClient,
  | 'getInventoryBackupStatus'
  | 'createInventoryBackup'
  | 'prepareInventoryRestore'
  | 'restoreInventory'
  | 'cancelInventoryRestore'
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
  getInventoryBackupStatus: async () => ({
    canRestore: true,
    blockerCodes: [],
    suggestedFileName: 'plysmith-backup-20261012-120000.pgn',
  }),
  createInventoryBackup: unexpected,
  prepareInventoryRestore: unexpected,
  restoreInventory: unexpected,
  cancelInventoryRestore: unexpected,
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
