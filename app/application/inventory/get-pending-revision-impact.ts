import type { RevisionImpactId } from '../../domain/identity/index.ts';
import type { PendingRevisionImpact } from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { revisionImpactNotFound } from './inventory-problems.ts';

export interface GetPendingRevisionImpactUseCase {
  execute(request: {
    readonly impactId: RevisionImpactId;
  }): Promise<PendingRevisionImpact>;
}

export class GetPendingRevisionImpact implements GetPendingRevisionImpactUseCase {
  readonly #reader: InventoryRevisionReader;

  constructor(reader: InventoryRevisionReader) {
    this.#reader = reader;
  }

  async execute(request: {
    readonly impactId: RevisionImpactId;
  }): Promise<PendingRevisionImpact> {
    const impact = await this.#reader.readPendingRevisionImpact(
      request.impactId,
    );
    if (impact === undefined) throw revisionImpactNotFound();
    return impact;
  }
}
