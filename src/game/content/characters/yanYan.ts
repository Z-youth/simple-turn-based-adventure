import type {
  NormalAttackRequest,
  ShieldValueAttackRequest,
} from '../../core/attacks'
import {
  completeBattleAction,
  startBattleAction,
} from '../../core/battleEngine'
import type { BattleEngineExtensions, BattleTransitionResult } from '../../core/battleEngine'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
} from '../../core/contexts'
import {
  BattlePhase,
  Camp,
  DamageType,
  PersonalTurnPhase,
  Position,
  UnitSystem,
} from '../../core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  SkillId,
  SpecialCounterId,
  UnitId,
} from '../../core/identifiers'
import { resolveResourcePaidSkillTransaction } from '../../core/resourceTransaction'
import { gainResource, ResourceType } from '../../core/resources'
import { roundIntegerResult } from '../../core/rounding'
import { gainShield } from '../../core/shields'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
  readSpecialCounter,
} from '../../core/specialCounters'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
  isUnitAlive,
} from '../../core/unitQueries'
import type { UnitState } from '../../core/units'

export const YAN_YAN_UNIT_ID = 'character:yan-yan' as UnitId
export const YAN_YAN_BAIYUE_RESTORE_COUNTER_ID =
  'counter:yan-yan:baiyue-restore' as SpecialCounterId
export const YAN_YAN_FIRST_SKILL_ID = 'skill:yan-yan:first' as SkillId
export const YAN_YAN_PEAKS_SKILL_ID = 'skill:yan-yan:peaks' as SkillId
export const YAN_YAN_RIDGES_SKILL_ID = 'skill:yan-yan:ridges' as SkillId
export const YAN_YAN_BAIYUE_SKILL_ID = 'skill:yan-yan:baiyue' as SkillId

const GUARD_MOMENTUM_GAIN = 2

export interface YanYanSingleTargetSkillRequest {
  readonly targetUnitId: UnitId
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface YanYanPeaksSkillRequest {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface YanYanBaiyueSkillRequest {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly normalAttackId: AttackId
  readonly shieldAttackId: AttackId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface YanYanEffectSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly import('../../core/events').BattleEvent[]
}

export interface YanYanEffectFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type YanYanEffectResult = YanYanEffectSuccess | YanYanEffectFailure

function failure(state: BattleState, reason: string): YanYanEffectFailure {
  return { ok: false, state, events: [], reason }
}

function findYanYan(state: BattleState): UnitState | null {
  const unit = state.units.find((candidate) => candidate.id === YAN_YAN_UNIT_ID)
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function skillContextIds(
  turn: PersonalTurnState,
  skillExecutionId: SkillExecutionId | null,
) {
  return {
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId,
  }
}

function gainYanYanShield(
  state: BattleState,
  turn: PersonalTurnState,
  amount: number,
  reason: string,
  allyShieldAmount: number,
  skillExecutionId: SkillExecutionId | null,
): YanYanEffectResult {
  if (amount <= 0) return { ok: true, state, events: [] }
  const self = gainShield(state, {
    unitId: YAN_YAN_UNIT_ID,
    amount,
    reason,
    sourceUnitId: YAN_YAN_UNIT_ID,
    effectId: reason,
    ...skillContextIds(turn, skillExecutionId),
  })
  if (!self.ok) return failure(state, self.reason)

  let currentState = self.state
  const events = [...self.events]
  if (allyShieldAmount <= 0) return { ok: true, state: currentState, events }
  const yanYan = findYanYan(currentState)
  if (yanYan === null) return failure(state, 'YAN_YAN_NOT_FOUND')
  for (const ally of currentState.units) {
    if (ally.id === yanYan.id || ally.camp !== yanYan.camp || !isUnitAlive(ally)) {
      continue
    }
    const granted = gainShield(currentState, {
      unitId: ally.id,
      amount: allyShieldAmount,
      reason: 'yanYanImmovableMountainAllyShield',
      sourceUnitId: YAN_YAN_UNIT_ID,
      effectId: 'yanYanImmovableMountainAllyShield',
      ...skillContextIds(turn, skillExecutionId),
    })
    if (!granted.ok) return failure(state, granted.reason)
    currentState = granted.state
    events.push(...granted.events)
  }
  return { ok: true, state: currentState, events }
}

function grantAlliedShieldThenTriggerYanYan(
  state: BattleState,
  turn: PersonalTurnState,
  amount: number,
  reason: string,
  skillExecutionId: SkillExecutionId,
): YanYanEffectResult {
  if (amount <= 0) return { ok: true, state, events: [] }
  const yanYan = findYanYan(state)
  if (yanYan === null) return failure(state, 'YAN_YAN_NOT_FOUND')
  let currentState = state
  const events: import('../../core/events').BattleEvent[] = []
  for (const ally of state.units) {
    if (ally.id === yanYan.id || ally.camp !== yanYan.camp || !isUnitAlive(ally)) {
      continue
    }
    const granted = gainShield(currentState, {
      unitId: ally.id,
      amount,
      reason,
      sourceUnitId: YAN_YAN_UNIT_ID,
      effectId: reason,
      ...skillContextIds(turn, skillExecutionId),
    })
    if (!granted.ok) return failure(state, granted.reason)
    currentState = granted.state
    events.push(...granted.events)
  }
  const triggered = gainYanYanShield(
    currentState,
    turn,
    amount,
    reason,
    amount,
    skillExecutionId,
  )
  if (!triggered.ok) return triggered
  return {
    ok: true,
    state: triggered.state,
    events: [...events, ...triggered.events],
  }
}

function createNormalAttack(
  unit: UnitState,
  attackId: AttackId,
  targetIds: readonly UnitId[],
  multiplier: number,
  fixedDamage: number,
  prefix: string,
): NormalAttackRequest {
  return {
    attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier,
    fixedDamage,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: targetIds.map((targetId) => ({
      targetId,
      damageEventId: `${prefix}:${targetId}` as DamageEventId,
    })),
  }
}

function createSingleTargetAttack(
  unit: UnitState,
  request: YanYanSingleTargetSkillRequest,
  multiplier: number,
): NormalAttackRequest {
  return {
    attackId: request.attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: [{
      targetId: request.targetUnitId,
      damageEventId: request.damageEventId,
    }],
  }
}

function validateSingleTarget(
  state: BattleState,
  targetUnitId: UnitId,
): boolean {
  const yanYan = findYanYan(state)
  const target = state.units.find((candidate) => candidate.id === targetUnitId)
  return yanYan !== null
    && target !== undefined
    && target.camp !== yanYan.camp
    && isUnitAlive(target)
}

function completeYanYanAction(
  initialState: BattleState,
  resolvedState: BattleState,
  actionId: ActionId,
  extensions: BattleEngineExtensions,
): YanYanEffectResult {
  const completed = completeBattleAction(resolvedState, actionId, extensions)
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(initialState.events.length),
  }
}

function didSpendMomentum(
  events: readonly import('../../core/events').BattleEvent[],
  skillExecutionId: SkillExecutionId,
): number {
  return events.reduce((total, event) => (
    event.type === 'RESOURCE_SPENT'
      && event.unitId === YAN_YAN_UNIT_ID
      && event.resourceType === ResourceType.Momentum
      && event.skillExecutionId === skillExecutionId
      ? total + event.amount
      : total
  ), 0)
}

function applyMomentumSpendShield(
  state: BattleState,
  turn: PersonalTurnState,
  skillExecutionId: SkillExecutionId,
  spentMomentum: number,
  momentumBeforePayment: number,
): YanYanEffectResult {
  return gainYanYanShield(
    state,
    turn,
    spentMomentum * 3,
    'yanYanImmovableMountainMomentumSpend',
    momentumBeforePayment,
    skillExecutionId,
  )
}

export function createYanYan(): UnitState {
  return {
    id: YAN_YAN_UNIT_ID,
    name: '严岩',
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Front2,
    deploymentOrder: 1,
    currentHealth: 180,
    maximumHealth: 180,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 10,
    temporaryAttributeModifiers: [],
    speed: 85,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    specialCounters: [],
    resourceReductionProtections: [],
    alive: true,
  }
}

export function applyYanYanTurnStartPreSystemEffects(
  state: BattleState,
  turn: PersonalTurnState,
): YanYanEffectResult {
  if (turn.unitId !== YAN_YAN_UNIT_ID) return { ok: true, state, events: [] }
  const yanYan = findYanYan(state)
  if (yanYan === null) return failure(state, 'YAN_YAN_NOT_FOUND')
  const reservedMomentum = readSpecialCounter(
    yanYan,
    YAN_YAN_BAIYUE_RESTORE_COUNTER_ID,
  )
  if (reservedMomentum === 0) return { ok: true, state, events: [] }
  const restored = gainResource(state, {
    unitId: yanYan.id,
    resourceType: ResourceType.Momentum,
    amount: roundIntegerResult(reservedMomentum / 2),
    reason: 'yanYanBaiyueRestore',
    sourceId: String(YAN_YAN_BAIYUE_SKILL_ID),
    sourceUnitId: yanYan.id,
    effectId: 'yanYanBaiyueRestore',
    actionId: null,
    ...skillContextIds(turn, null),
    resourceTransactionId: null,
  })
  if (!restored.ok) return failure(state, restored.reason)
  const cleared = decreaseSpecialCounter(restored.state, {
    unitId: yanYan.id,
    counterId: YAN_YAN_BAIYUE_RESTORE_COUNTER_ID,
    amount: reservedMomentum,
    sourceUnitId: yanYan.id,
    effectId: 'yanYanBaiyueRestore',
    actionId: null,
    ...skillContextIds(turn, null),
  })
  if (!cleared.ok) return failure(state, cleared.reason)
  return {
    ok: true,
    state: cleared.state,
    events: [...restored.events, ...cleared.events],
  }
}

export function applyYanYanAfterActionEffects(
  state: BattleState,
  action: ActionContext,
): YanYanEffectResult {
  if (action.skillExecutionId === null || findYanYan(state) === null) {
    return { ok: true, state, events: [] }
  }
  const wasAttacked = state.events.some((event) => (
    event.type === 'ATTACK_STARTED'
    && event.context.skillExecutionId === action.skillExecutionId
    && event.context.targets.some((target) => (
      target.targetId === YAN_YAN_UNIT_ID && target.hit
    ))
  ))
  if (!wasAttacked) return { ok: true, state, events: [] }
  const gained = gainResource(state, {
    unitId: YAN_YAN_UNIT_ID,
    resourceType: ResourceType.Momentum,
    amount: GUARD_MOMENTUM_GAIN,
    reason: 'yanYanGuardStance',
    sourceId: String(YAN_YAN_UNIT_ID),
    sourceUnitId: YAN_YAN_UNIT_ID,
    effectId: 'yanYanGuardStance',
    actionId: action.actionId,
    personalTurnId: action.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: action.skillExecutionId,
    resourceTransactionId: null,
  })
  if (!gained.ok) return failure(state, gained.reason)
  return gained
}

export function applyYanYanTurnEndEffects(
  state: BattleState,
  turn: PersonalTurnState,
): YanYanEffectResult {
  if (
    turn.unitId !== YAN_YAN_UNIT_ID
    || turn.phase !== PersonalTurnPhase.EndingUnitSpecificEffects
  ) return { ok: true, state, events: [] }
  const yanYan = findYanYan(state)
  if (yanYan === null) return { ok: true, state, events: [] }
  return gainYanYanShield(
    state,
    turn,
    yanYan.momentum * 2,
    'yanYanImmovableMountainTurnEnd',
    yanYan.momentum,
    null,
  )
}

export function useYanYanFirstSkill(
  state: BattleState,
  request: YanYanSingleTargetSkillRequest,
  extensions: BattleEngineExtensions = YAN_YAN_BATTLE_EXTENSIONS,
): YanYanEffectResult {
  const turn = state.personalTurn
  const yanYan = findYanYan(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== YAN_YAN_UNIT_ID
    || yanYan === null
  ) return failure(state, 'YAN_YAN_NOT_READY_FOR_FIRST_SKILL')
  if (!validateSingleTarget(state, request.targetUnitId)) {
    return failure(state, 'YAN_YAN_FIRST_SKILL_INVALID_TARGET')
  }
  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: yanYan.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) return failure(state, 'YAN_YAN_FIRST_SKILL_CONTEXT_MISSING')
  const attack = createSingleTargetAttack(
    { ...yanYan, momentum: yanYan.momentum + 2 },
    request,
    0.8,
  )
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    payerUnitId: yanYan.id,
    costs: [],
  }, {
    skillExecutionId: request.skillExecutionId,
    skillId: YAN_YAN_FIRST_SKILL_ID,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: yanYan.id,
    attacks: [attack],
    effects: [
      {
        kind: 'resource', operation: 'gain', unitId: yanYan.id,
        resourceType: ResourceType.Energy, amount: 1, reason: 'yanYanFirstSkill',
      },
      {
        kind: 'resource', operation: 'gain', unitId: yanYan.id,
        resourceType: ResourceType.Momentum, amount: 2, reason: 'yanYanFirstSkill',
      },
      { kind: 'attack', attack },
    ],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const shielded = gainYanYanShield(
    resolved.state,
    activeTurn,
    10 + (findYanYan(resolved.state)?.momentum ?? 0),
    'yanYanFirstSkill',
    findYanYan(resolved.state)?.momentum ?? 0,
    request.skillExecutionId,
  )
  if (!shielded.ok) return shielded
  return completeYanYanAction(state, shielded.state, request.actionId, extensions)
}

export function useYanYanPeaksSkill(
  state: BattleState,
  request: YanYanPeaksSkillRequest,
  extensions: BattleEngineExtensions = YAN_YAN_BATTLE_EXTENSIONS,
): YanYanEffectResult {
  const turn = state.personalTurn
  const yanYan = findYanYan(state)
  if (
    state.phase !== BattlePhase.AwaitingAction || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== YAN_YAN_UNIT_ID || yanYan === null
  ) return failure(state, 'YAN_YAN_NOT_READY_FOR_PEAKS_SKILL')
  const started = startBattleAction(state, {
    actionId: request.actionId, actorId: yanYan.id,
    skillExecutionId: request.skillExecutionId, countsAsAction: true, endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) return failure(state, 'YAN_YAN_PEAKS_SKILL_CONTEXT_MISSING')
  const gainedMomentum = roundIntegerResult(yanYan.momentum / 2)
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId, actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId, sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId, payerUnitId: yanYan.id, costs: [],
  }, {
    skillExecutionId: request.skillExecutionId, skillId: YAN_YAN_PEAKS_SKILL_ID,
    actionId: request.actionId, personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId, casterId: yanYan.id, attacks: [], effects: [{
      kind: 'resource', operation: 'gain', unitId: yanYan.id,
      resourceType: ResourceType.Momentum, amount: gainedMomentum, reason: 'yanYanPeaks',
    }],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const currentMomentum = findYanYan(resolved.state)?.momentum
  if (currentMomentum === undefined) return failure(state, 'YAN_YAN_NOT_FOUND')
  const shielded = grantAlliedShieldThenTriggerYanYan(
    resolved.state, activeTurn, currentMomentum, 'yanYanPeaks', request.skillExecutionId,
  )
  if (!shielded.ok) return shielded
  return completeYanYanAction(state, shielded.state, request.actionId, extensions)
}

export function useYanYanRidgesSkill(
  state: BattleState,
  request: YanYanSingleTargetSkillRequest,
  extensions: BattleEngineExtensions = YAN_YAN_BATTLE_EXTENSIONS,
): YanYanEffectResult {
  const turn = state.personalTurn
  const yanYan = findYanYan(state)
  if (
    state.phase !== BattlePhase.AwaitingAction || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== YAN_YAN_UNIT_ID || yanYan === null
  ) return failure(state, 'YAN_YAN_NOT_READY_FOR_RIDGES_SKILL')
  if (!validateSingleTarget(state, request.targetUnitId)) {
    return failure(state, 'YAN_YAN_RIDGES_SKILL_INVALID_TARGET')
  }
  if (yanYan.energy < 1 || yanYan.momentum < 5) {
    return failure(state, 'YAN_YAN_RIDGES_SKILL_INSUFFICIENT_RESOURCE')
  }
  const started = startBattleAction(state, {
    actionId: request.actionId, actorId: yanYan.id,
    skillExecutionId: request.skillExecutionId, countsAsAction: true, endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) return failure(state, 'YAN_YAN_RIDGES_SKILL_CONTEXT_MISSING')
  const attack = createSingleTargetAttack(yanYan, request, 1)
  const targetMomentum = state.units.find((unit) => (
    unit.id === request.targetUnitId
  ))?.momentum ?? 0
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId, actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId, sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId, payerUnitId: yanYan.id,
    costs: [{ resourceType: ResourceType.Energy, amount: 1 }, { resourceType: ResourceType.Momentum, amount: 5 }],
  }, {
    skillExecutionId: request.skillExecutionId, skillId: YAN_YAN_RIDGES_SKILL_ID,
    actionId: request.actionId, personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId, casterId: yanYan.id, attacks: [attack], effects: [
      { kind: 'attack', attack },
      ...(targetMomentum === 0 ? [] : [{
        kind: 'resource' as const,
        operation: 'spend' as const,
        unitId: request.targetUnitId,
        resourceType: ResourceType.Momentum,
        amount: Math.min(4, targetMomentum),
        reason: 'yanYanRidges',
      }]),
    ],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const shielded = applyMomentumSpendShield(
    resolved.state, activeTurn, request.skillExecutionId,
    didSpendMomentum(resolved.events, request.skillExecutionId), yanYan.momentum,
  )
  if (!shielded.ok) return shielded
  return completeYanYanAction(state, shielded.state, request.actionId, extensions)
}

export function useYanYanBaiyueSkill(
  state: BattleState,
  request: YanYanBaiyueSkillRequest,
  extensions: BattleEngineExtensions = YAN_YAN_BATTLE_EXTENSIONS,
): YanYanEffectResult {
  const turn = state.personalTurn
  const yanYan = findYanYan(state)
  if (
    state.phase !== BattlePhase.AwaitingAction || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== YAN_YAN_UNIT_ID || yanYan === null
  ) return failure(state, 'YAN_YAN_NOT_READY_FOR_BAIYUE_SKILL')
  if (yanYan.momentum < 1) return failure(state, 'YAN_YAN_BAIYUE_SKILL_INSUFFICIENT_MOMENTUM')
  const enemies = state.units.filter((unit) => unit.camp !== yanYan.camp && isUnitAlive(unit))
  if (enemies.length === 0) return failure(state, 'YAN_YAN_BAIYUE_SKILL_NO_TARGET')
  const reservedMomentum = yanYan.momentum
  const shieldSnapshot = yanYan.shield
  const started = startBattleAction(state, {
    actionId: request.actionId, actorId: yanYan.id,
    skillExecutionId: request.skillExecutionId, countsAsAction: true, endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) return failure(state, 'YAN_YAN_BAIYUE_SKILL_CONTEXT_MISSING')
  const normal = createNormalAttack(
    yanYan, request.normalAttackId, enemies.map((enemy) => enemy.id), 0.5,
    reservedMomentum * 2, `${request.skillExecutionId}:normal`,
  )
  const shield: ShieldValueAttackRequest = {
    attackId: request.shieldAttackId,
    damageType: DamageType.ShieldValue,
    baseValue: shieldSnapshot,
    normalDamageIncrease: yanYan.normalDamageIncrease,
    targets: enemies.map((enemy) => ({
      targetId: enemy.id,
      damageEventId: `${request.skillExecutionId}:shield:${enemy.id}` as DamageEventId,
    })),
  }
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId, actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId, sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId, payerUnitId: yanYan.id,
    costs: [{ resourceType: ResourceType.Momentum, amount: reservedMomentum }],
  }, {
    skillExecutionId: request.skillExecutionId, skillId: YAN_YAN_BAIYUE_SKILL_ID,
    actionId: request.actionId, personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId, casterId: yanYan.id, attacks: [normal, shield],
    effects: [{ kind: 'attack', attack: normal }, { kind: 'attack', attack: shield }],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const spentMomentum = didSpendMomentum(resolved.events, request.skillExecutionId)
  if (spentMomentum === 0) return completeYanYanAction(
    state,
    resolved.state,
    request.actionId,
    extensions,
  )
  const stored = increaseSpecialCounter(resolved.state, {
    unitId: yanYan.id, counterId: YAN_YAN_BAIYUE_RESTORE_COUNTER_ID,
    amount: reservedMomentum, actionId: request.actionId,
    sourceUnitId: yanYan.id,
    effectId: String(YAN_YAN_BAIYUE_SKILL_ID),
    ...skillContextIds(activeTurn, request.skillExecutionId),
  })
  if (!stored.ok) return failure(state, stored.reason)
  const shielded = applyMomentumSpendShield(
    stored.state, activeTurn, request.skillExecutionId,
    spentMomentum, reservedMomentum,
  )
  if (!shielded.ok) return shielded
  return completeYanYanAction(state, shielded.state, request.actionId, extensions)
}

export const YAN_YAN_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  applyTurnStartPreSystemEffects(state, turn): BattleTransitionResult {
    return applyYanYanTurnStartPreSystemEffects(state, turn)
  },
  applyAfterActionEffects(state, action) {
    return applyYanYanAfterActionEffects(state, action)
  },
  applyUnitTurnEndEffects(state, turn) {
    return applyYanYanTurnEndEffects(state, turn)
  },
}
