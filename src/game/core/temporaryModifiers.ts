import { PersonalTurnPhase } from './enums'
import type { BattleState } from './contexts'
import type { BattleEvent } from './events'
import type {
  ActionId,
  PersonalTurnId,
  SkillExecutionId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import type { ModifierSourceId, UnitState } from './units'

export const TemporaryAttribute = Object.freeze({
  Attack: 'attack',
  CriticalRate: 'criticalRate',
  CriticalDamage: 'criticalDamage',
} as const)

export type TemporaryAttribute =
  (typeof TemporaryAttribute)[keyof typeof TemporaryAttribute]

export type TemporaryModifierDurationRequest =
  | { readonly kind: 'currentPersonalTurn' }
  | { readonly kind: 'ownerTurns'; readonly turns: number }

export type TemporaryModifierDuration =
  | {
      readonly kind: 'currentPersonalTurn'
      readonly personalTurnId: PersonalTurnId
    }
  | {
      readonly kind: 'ownerTurns'
      readonly remainingTurns: number
    }

export interface TemporaryAttributeModifier {
  readonly sourceId: ModifierSourceId
  readonly sourceUnitId?: UnitId | null
  readonly attribute: TemporaryAttribute
  readonly value: number
  readonly duration: TemporaryModifierDuration
}

export type TemporaryModifierErrorCode =
  | 'TEMPORARY_ATTRIBUTE_OWNER_NOT_FOUND'
  | 'TEMPORARY_ATTRIBUTE_OWNER_DEAD'
  | 'TEMPORARY_MODIFIER_CURRENT_TURN_MISMATCH'
  | 'TEMPORARY_MODIFIER_TURN_MISMATCH'
  | 'INVALID_TEMPORARY_ATTRIBUTE'
  | 'INVALID_TEMPORARY_ATTRIBUTE_VALUE'
  | 'INVALID_TEMPORARY_MODIFIER_DURATION'
  | 'INVALID_TEMPORARY_MODIFIER_STATE'

export interface ApplyTemporaryAttributeModifierRequest {
  readonly unitId: UnitId
  readonly sourceUnitId?: UnitId | null
  readonly effectId?: ModifierSourceId
  readonly attribute: TemporaryAttribute
  readonly value: number
  readonly duration: TemporaryModifierDurationRequest
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface TemporaryModifierSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface TemporaryModifierFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: TemporaryModifierErrorCode
}

export type TemporaryModifierResult =
  | TemporaryModifierSuccess
  | TemporaryModifierFailure

const ATTRIBUTE_ORDER: readonly TemporaryAttribute[] = Object.freeze([
  TemporaryAttribute.Attack,
  TemporaryAttribute.CriticalRate,
  TemporaryAttribute.CriticalDamage,
])

function failure(
  state: BattleState,
  reason: TemporaryModifierErrorCode,
): TemporaryModifierFailure {
  return { ok: false, state, events: [], reason }
}

function durationIsValid(duration: unknown): boolean {
  if (duration === null || typeof duration !== 'object') return false
  if ('kind' in duration && duration.kind === 'currentPersonalTurn') {
    return 'personalTurnId' in duration
      && typeof duration.personalTurnId === 'string'
      && duration.personalTurnId.length > 0
  }
  return 'kind' in duration
    && duration.kind === 'ownerTurns'
    && 'remainingTurns' in duration
    && typeof duration.remainingTurns === 'number'
    && Number.isSafeInteger(duration.remainingTurns)
    && duration.remainingTurns > 0
}

export function validateTemporaryAttributeModifiers(
  unit: UnitState,
): TemporaryModifierErrorCode | null {
  if (!Array.isArray(unit.temporaryAttributeModifiers)) {
    return 'INVALID_TEMPORARY_MODIFIER_STATE'
  }
  for (const modifier of unit.temporaryAttributeModifiers) {
    if (
      modifier === null
      || typeof modifier !== 'object'
      || typeof modifier.sourceId !== 'string'
      || modifier.sourceId.length === 0
      || !ATTRIBUTE_ORDER.includes(modifier.attribute)
      || !Number.isFinite(modifier.value)
      || !durationIsValid(modifier.duration)
    ) return 'INVALID_TEMPORARY_MODIFIER_STATE'
  }
  return null
}

function replaceUnit(
  state: BattleState,
  replacement: UnitState,
  events: readonly BattleEvent[],
): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => (
      unit.id === replacement.id ? replacement : unit
    )),
    events: [...state.events, ...events],
  }
}

function modifierEvent(
  operation: TemporaryAttributeChangedEventOperation,
  unitId: UnitId,
  modifier: TemporaryAttributeModifier,
  context: {
    readonly actionId: ActionId | null
    readonly personalTurnId: PersonalTurnId | null
    readonly sequenceId: TurnSequenceId | null
    readonly skillExecutionId: SkillExecutionId | null
  },
  remainingOwnerTurns: number | null,
): BattleEvent {
  return {
    type: 'TEMPORARY_ATTRIBUTE_CHANGED',
    operation,
    unitId,
    attribute: modifier.attribute,
    sourceUnitId: modifier.sourceUnitId ?? null,
    effectId: modifier.sourceId,
    value: modifier.value,
    durationKind: modifier.duration.kind,
    remainingOwnerTurns,
    expiresAtPersonalTurnId: modifier.duration.kind === 'currentPersonalTurn'
      ? modifier.duration.personalTurnId
      : null,
    ...context,
  }
}

type TemporaryAttributeChangedEventOperation =
  'applied' | 'durationDecremented' | 'removed'

export function applyTemporaryAttributeModifier(
  state: BattleState,
  request: ApplyTemporaryAttributeModifierRequest,
): TemporaryModifierResult {
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'TEMPORARY_ATTRIBUTE_OWNER_NOT_FOUND')
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return failure(state, 'TEMPORARY_ATTRIBUTE_OWNER_DEAD')
  }
  const invalidExisting = validateTemporaryAttributeModifiers(unit)
  if (invalidExisting !== null) return failure(state, invalidExisting)
  if (!ATTRIBUTE_ORDER.includes(request.attribute)) {
    return failure(state, 'INVALID_TEMPORARY_ATTRIBUTE')
  }
  if (typeof request.effectId !== 'string' || request.effectId.length === 0) {
    return failure(state, 'INVALID_TEMPORARY_MODIFIER_STATE')
  }
  if (!Number.isFinite(request.value)) {
    return failure(state, 'INVALID_TEMPORARY_ATTRIBUTE_VALUE')
  }
  if (request.duration === null || typeof request.duration !== 'object') {
    return failure(state, 'INVALID_TEMPORARY_MODIFIER_DURATION')
  }
  let duration: TemporaryModifierDuration
  if (request.duration.kind === 'currentPersonalTurn') {
    const turn = state.personalTurn
    if (
      request.personalTurnId === null
      || turn === null
      || turn.personalTurnId !== request.personalTurnId
      || turn.unitId !== request.unitId
      || turn.phase === PersonalTurnPhase.Ended
    ) return failure(state, 'TEMPORARY_MODIFIER_CURRENT_TURN_MISMATCH')
    duration = {
      kind: 'currentPersonalTurn',
      personalTurnId: request.personalTurnId,
    }
  } else if (request.duration.kind === 'ownerTurns') {
    if (!Number.isSafeInteger(request.duration.turns)
      || request.duration.turns <= 0) {
      return failure(state, 'INVALID_TEMPORARY_MODIFIER_DURATION')
    }
    duration = {
      kind: 'ownerTurns',
      remainingTurns: request.duration.turns,
    }
  } else {
    return failure(state, 'INVALID_TEMPORARY_MODIFIER_DURATION')
  }
  const modifier: TemporaryAttributeModifier = {
    sourceId: request.effectId,
    sourceUnitId: request.sourceUnitId ?? null,
    attribute: request.attribute,
    value: request.value,
    duration,
  }
  const event = modifierEvent(
    'applied',
    request.unitId,
    modifier,
    {
      actionId: request.actionId,
      personalTurnId: request.personalTurnId,
      sequenceId: request.sequenceId,
      skillExecutionId: request.skillExecutionId,
    },
    duration.kind === 'ownerTurns' ? duration.remainingTurns : null,
  )
  const replacement: UnitState = {
    ...unit,
    temporaryAttributeModifiers: [
      ...unit.temporaryAttributeModifiers,
      modifier,
    ],
  }
  return {
    ok: true,
    state: replaceUnit(state, replacement, [event]),
    events: [event],
  }
}

export function advanceTemporaryAttributeModifiers(
  state: BattleState,
  ownerUnitId: UnitId,
  personalTurnId: PersonalTurnId,
): TemporaryModifierResult {
  const unit = state.units.find((candidate) => candidate.id === ownerUnitId)
  if (unit === undefined) return failure(state, 'TEMPORARY_ATTRIBUTE_OWNER_NOT_FOUND')
  const invalid = validateTemporaryAttributeModifiers(unit)
  if (invalid !== null) return failure(state, invalid)
  const turn = state.personalTurn
  if (
    turn === null
    || turn.personalTurnId !== personalTurnId
    || turn.unitId !== ownerUnitId
    || turn.phase !== PersonalTurnPhase.EndingTemporaryModifiers
  ) return failure(state, 'TEMPORARY_MODIFIER_TURN_MISMATCH')
  const context = {
    actionId: null,
    personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  }
  const modifiers: TemporaryAttributeModifier[] = []
  const events: BattleEvent[] = []
  for (const modifier of unit.temporaryAttributeModifiers) {
    if (modifier.duration.kind === 'currentPersonalTurn') {
      if (modifier.duration.personalTurnId === personalTurnId) {
        events.push(modifierEvent(
          'removed',
          ownerUnitId,
          modifier,
          context,
          null,
        ))
      } else {
        modifiers.push(modifier)
      }
      continue
    }
    const remainingTurns = modifier.duration.remainingTurns - 1
    if (remainingTurns === 0) {
      events.push(modifierEvent(
        'removed',
        ownerUnitId,
        modifier,
        context,
        0,
      ))
    } else {
      const decremented: TemporaryAttributeModifier = {
        ...modifier,
        duration: { kind: 'ownerTurns', remainingTurns },
      }
      modifiers.push(decremented)
      events.push(modifierEvent(
        'durationDecremented',
        ownerUnitId,
        decremented,
        context,
        remainingTurns,
      ))
    }
  }
  if (events.length === 0) return { ok: true, state, events: [] }
  const replacement: UnitState = {
    ...unit,
    temporaryAttributeModifiers: modifiers,
  }
  return {
    ok: true,
    state: replaceUnit(state, replacement, events),
    events,
  }
}
