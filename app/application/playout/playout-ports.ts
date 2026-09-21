import type {
  CanonicalMove,
  ChessState,
} from '../../domain/chess_graph/index.ts';
import type {
  HumanMovePolicyProfile,
  MovePolicyBinding,
  MovePolicyCapability,
} from '../../domain/playout/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type {
  PersistDiscardPlayoutRequest,
  PersistCompletePlayoutRequest,
  PersistReplacePlayoutRequest,
  PersistStartPlayoutRequest,
  PlayoutChanged,
  StoredPlayout,
  CompletePlayoutResult,
  CompletePlayoutRequest,
} from './playout-models.ts';

export interface PlayoutReader {
  readPlayout(scope: WorkScope): Promise<StoredPlayout | undefined>;
  readPlayoutCompletion(
    request: CompletePlayoutRequest,
  ): Promise<CompletePlayoutResult | undefined>;
}

export interface PlayoutWriter {
  createPlayout(request: PersistStartPlayoutRequest): Promise<StoredPlayout>;
  replacePlayout(request: PersistReplacePlayoutRequest): Promise<StoredPlayout>;
  discardPlayout(request: PersistDiscardPlayoutRequest): Promise<{
    readonly dataRevision: number;
  }>;
  completePlayout(
    request: PersistCompletePlayoutRequest,
  ): Promise<CompletePlayoutResult>;
}

export interface PlayoutChangedPublisher {
  publish(event: PlayoutChanged): void;
}

export interface MovePolicyProviderDescriptor {
  readonly instanceId: string;
  readonly providerType: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly capabilities: readonly MovePolicyCapability[];
  readonly profile?: HumanMovePolicyProfile;
  readonly readiness: 'cold' | 'ready';
  readonly status: 'available' | 'unavailable';
  readonly problemCode?: string;
}

export interface MovePolicyRequest {
  readonly root: ChessState;
  readonly moves: readonly CanonicalMove[];
  readonly current: ChessState;
  readonly decisionId: number;
}

export interface MovePolicyDecision {
  readonly move: CanonicalMove;
  readonly providerInstanceId: string;
  readonly providerFingerprint: string;
  readonly reproducibility: 'deterministic' | 'unknown';
}

export type MovePolicyFailureCode =
  | 'provider_unavailable'
  | 'provider_protocol_error'
  | 'provider_timeout'
  | 'provider_resource_exhausted'
  | 'capability_missing'
  | 'illegal_engine_move'
  | 'interrupted';

export class MovePolicyProviderError extends Error {
  readonly code: MovePolicyFailureCode;

  constructor(code: MovePolicyFailureCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'MovePolicyProviderError';
    this.code = code;
  }
}

export interface MovePolicyProvider {
  readonly descriptor: MovePolicyProviderDescriptor;
  chooseMove(request: MovePolicyRequest): Promise<MovePolicyDecision>;
}

export interface MovePolicyRegistry {
  list(): readonly MovePolicyProviderDescriptor[];
  resolve(
    instanceId: string,
    capability: MovePolicyCapability,
  ): MovePolicyProvider | undefined;
}

export interface PlayoutClock {
  now(): string;
}

export function policyBinding(
  descriptor: MovePolicyProviderDescriptor,
  capability: MovePolicyCapability,
): MovePolicyBinding {
  const base = {
    capability,
    providerInstanceId: descriptor.instanceId,
    providerFingerprint: descriptor.fingerprint,
    providerType: descriptor.providerType,
    providerDisplayName: descriptor.displayName,
  } as const;
  if (capability === 'human_profile') {
    if (descriptor.profile === undefined) {
      throw new MovePolicyProviderError('capability_missing');
    }
    return Object.freeze({
      ...base,
      capability,
      profile: Object.freeze({ ...descriptor.profile }),
    });
  }
  return Object.freeze({ ...base, capability });
}
