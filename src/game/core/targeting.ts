import type { BattleState } from './contexts'
import type { Camp } from './enums'
import type { UnitId } from './identifiers'
import { readRandomValue } from './rng'
import { isFrontPosition, isUnitAlive } from './unitQueries'
import type { UnitState } from './units'

export interface LegalTargetPoolRequest {
  readonly camp: Camp
  readonly excludeUnitIds?: readonly UnitId[]
  readonly isLegal?: (unit: UnitState) => boolean
}

export interface RandomTargetResult {
  readonly state: BattleState
  readonly target: UnitState | null
}

export function getLivingLegalTargetPool(
  state: BattleState,
  request: LegalTargetPoolRequest,
): readonly UnitState[] {
  const excluded = new Set(request.excludeUnitIds ?? [])
  return state.units.filter((unit) => (
    unit.camp === request.camp
    && isUnitAlive(unit)
    && !excluded.has(unit.id)
    && (request.isLegal?.(unit) ?? true)
  ))
}

export function getAllLivingLegalTargets(
  state: BattleState,
  request: LegalTargetPoolRequest,
): readonly UnitState[] {
  return getLivingLegalTargetPool(state, request)
}

function chooseFromPool(
  state: BattleState,
  pool: readonly UnitState[],
): RandomTargetResult {
  if (pool.length === 0) return { state, target: null }
  const random = readRandomValue(state.rngState)
  const index = Math.min(Math.floor(random.value * pool.length), pool.length - 1)
  return {
    state: { ...state, rngState: random.state },
    target: pool[index] ?? null,
  }
}

export function chooseRandomLivingLegalTarget(
  state: BattleState,
  request: LegalTargetPoolRequest,
): RandomTargetResult {
  return chooseFromPool(state, getLivingLegalTargetPool(state, request))
}

export function chooseFrontPriorityRandomTarget(
  state: BattleState,
  request: LegalTargetPoolRequest,
): RandomTargetResult {
  const pool = getLivingLegalTargetPool(state, request)
  const frontPool = pool.filter((unit) => isFrontPosition(unit.position))
  return chooseFromPool(state, frontPool.length > 0 ? frontPool : pool)
}
