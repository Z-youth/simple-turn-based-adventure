import type { DamageType } from './enums'
import type { UnitId } from './identifiers'
import { roundDecimalResult } from './rounding'

export interface DamageShare {
  readonly targetId: UnitId
  readonly ratio: number
}

export interface SplitDamageShare {
  readonly targetId: UnitId
  readonly valueBeforeDefense: number
}

export interface DamageSharingSuccess {
  readonly ok: true
  readonly shares: readonly SplitDamageShare[]
}

export interface DamageSharingFailure {
  readonly ok: false
  readonly shares: readonly []
  readonly reason: 'EXTRA_DAMAGE_CANNOT_BE_SHARED' | 'INVALID_DAMAGE_SHARES'
}

export type DamageSharingResult = DamageSharingSuccess | DamageSharingFailure

export function splitDamageBeforeDefense(
  damageType: DamageType,
  valueBeforeDefense: number,
  shares: readonly DamageShare[],
): DamageSharingResult {
  if (damageType === 'extra') {
    return {
      ok: false,
      shares: [],
      reason: 'EXTRA_DAMAGE_CANNOT_BE_SHARED',
    }
  }
  const total = shares.reduce((sum, share) => sum + share.ratio, 0)
  if (
    !Number.isFinite(valueBeforeDefense)
    || valueBeforeDefense < 0
    || shares.length === 0
    || shares.some((share) => (
      !Number.isFinite(share.ratio) || share.ratio <= 0
    ))
    || Math.abs(total - 1) > Number.EPSILON * shares.length
    || new Set(shares.map((share) => share.targetId)).size !== shares.length
  ) {
    return { ok: false, shares: [], reason: 'INVALID_DAMAGE_SHARES' }
  }
  return {
    ok: true,
    shares: shares.map((share) => ({
      targetId: share.targetId,
      valueBeforeDefense: roundDecimalResult(valueBeforeDefense * share.ratio),
    })),
  }
}
