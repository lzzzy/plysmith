import type { PositionAnalysisRegistry } from '../analysis/public.ts';
import type { MovePolicyRegistry } from '../playout/index.ts';
import type { FairPlayGate } from './fair-play-gate.ts';

export function fairPlayPositionAnalyses(
  providers: PositionAnalysisRegistry,
  gate: FairPlayGate,
): PositionAnalysisRegistry {
  return {
    list: () => providers.list(),
    resolve(instanceId, capability) {
      const provider = providers.resolve(instanceId, capability);
      if (provider === undefined) return undefined;
      return {
        get descriptor() {
          return provider.descriptor;
        },
        analyze: (request, signal) =>
          gate.run((guarded) => provider.analyze(request, guarded), signal),
      };
    },
  };
}

export function fairPlayMovePolicies(
  providers: MovePolicyRegistry,
  gate: FairPlayGate,
): MovePolicyRegistry {
  return {
    list: () => providers.list(),
    resolve(instanceId, capability) {
      const provider = providers.resolve(instanceId, capability);
      if (provider === undefined) return undefined;
      return {
        get descriptor() {
          return provider.descriptor;
        },
        chooseMove: (request, signal) =>
          gate.run((guarded) => provider.chooseMove(request, guarded), signal),
      };
    },
  };
}
