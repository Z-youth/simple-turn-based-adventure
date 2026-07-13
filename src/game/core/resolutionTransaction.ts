import { BattlePhase, DamageType, PersonalTurnPhase } from './enums'
import type {
  AttackContext,
  BattleState,
  DamageEvent,
  SkillContext,
} from './contexts'
import type { BattleEvent } from './events'
import type {
  AttackId,
  DamageEventId,
  UnitId,
} from './identifiers'
import type {
  AttackRequest,
  AttackTargetRequest,
  SkillResolutionRequest,
} from './attacks'
import {
  calculateExtraDamage,
  calculateNormalDamage,
  calculateShieldValueDamage,
} from './damage'
import {
  calculateDirectHealthDamage,
  calculateShieldedDamage,
} from './shields'
import {
  createPositionProtectionSnapshot,
  getPositionProtectionReduction,
} from './positionProtection'
import { acquirePerTargetTriggerLock } from './triggerLocks'
import type { UnitState } from './units'
import type { RandomState } from './rng'
import { validateRandomState } from './rng'
import type { CombatUnitValidationErrorCode } from './combatValidation'
import { validateCombatUnit } from './combatValidation'

export type SkillResolutionErrorCode = CombatUnitValidationErrorCode
  | 'NOT_AT_SKILL_RESOLUTION_BOUNDARY'
  | 'NO_ACTIVE_ACTION'
  | 'ACTIVE_SKILL_ALREADY_EXISTS'
  | 'ACTION_ID_MISMATCH'
  | 'PERSONAL_TURN_ID_MISMATCH'
  | 'SEQUENCE_ID_MISMATCH'
  | 'CASTER_ID_MISMATCH'
  | 'SKILL_EXECUTION_ID_MISMATCH'
  | 'SKILL_EXECUTION_ID_ALREADY_USED'
  | 'ATTACK_ID_ALREADY_USED'
  | 'DAMAGE_EVENT_ID_ALREADY_USED'
  | 'DUPLICATE_TARGET_ID'
  | 'ATTACKER_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_INVALID_BEFORE_SKILL_START'
  | 'INVALID_DAMAGE_TYPE'
  | 'INVALID_NUMERIC_INPUT'
  | 'INVALID_RANDOM_STATE'
  | 'INVALID_SHIELD_CALCULATION'
  | 'RANDOM_SOURCE_EXHAUSTED'

export interface SkillResolutionSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface SkillResolutionFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: SkillResolutionErrorCode
}

export type SkillResolutionResult =
  | SkillResolutionSuccess
  | SkillResolutionFailure

function failure(
  state: BattleState,
  reason: SkillResolutionErrorCode,
): SkillResolutionFailure {
  return { ok: false, state, events: [], reason }
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function attackNumbersAreValid(attack: AttackRequest): boolean {
  const reductionsValid = attack.targets.every((target) => (
    (target.additionalReductionSources ?? []).every(isFiniteNumber)
    && (target.extraDamage === undefined
      || (isFiniteNumber(target.extraDamage.value)
        && target.extraDamage.value >= 0))
  ))
  if (!reductionsValid) return false
  if (attack.damageType === DamageType.Normal) {
    return [
      attack.effectiveAttack,
      attack.multiplier,
      attack.fixedDamage,
      attack.criticalRate,
      attack.criticalDamage,
      attack.normalDamageIncrease,
    ].every(isFiniteNumber)
  }
  if (attack.damageType === DamageType.ShieldValue) {
    return attack.baseValue >= 0
      && [attack.baseValue, attack.normalDamageIncrease].every(isFiniteNumber)
  }
  return false
}

function duplicateValue<Value>(values: readonly Value[]): boolean {
  return new Set(values).size !== values.length
}

function collectDamageEventIds(
  attacks: readonly AttackRequest[],
): readonly DamageEventId[] {
  return attacks.flatMap((attack) => attack.targets.flatMap((target) => (
    target.extraDamage === undefined
      ? [target.damageEventId]
      : [target.damageEventId, target.extraDamage.damageEventId]
  )))
}

function validateRequest(
  state: BattleState,
  request: SkillResolutionRequest,
): SkillResolutionErrorCode | null {
  if (
    state.phase !== BattlePhase.ResolvingAction
    || state.personalTurn?.phase !== PersonalTurnPhase.ResolvingAction
  ) return 'NOT_AT_SKILL_RESOLUTION_BOUNDARY'
  if (state.activeAction === null) return 'NO_ACTIVE_ACTION'
  if (state.activeSkill !== null) return 'ACTIVE_SKILL_ALREADY_EXISTS'
  if (state.completedSkillResolution !== null) {
    return 'SKILL_EXECUTION_ID_ALREADY_USED'
  }
  if (state.activeAction.actionId !== request.actionId) return 'ACTION_ID_MISMATCH'
  if (state.personalTurn.personalTurnId !== request.personalTurnId) {
    return 'PERSONAL_TURN_ID_MISMATCH'
  }
  if (state.activeAction.sequenceId !== request.sequenceId) {
    return 'SEQUENCE_ID_MISMATCH'
  }
  if (state.activeAction.actorId !== request.casterId) return 'CASTER_ID_MISMATCH'
  if (state.activeAction.skillExecutionId !== request.skillExecutionId) {
    return 'SKILL_EXECUTION_ID_MISMATCH'
  }
  if (state.resolutionIds.skillExecutionIds.includes(request.skillExecutionId)) {
    return 'SKILL_EXECUTION_ID_ALREADY_USED'
  }

  if (validateRandomState(state.rngState) !== null) return 'INVALID_RANDOM_STATE'

  const attacker = state.units.find((unit) => unit.id === request.casterId)
  if (attacker === undefined) return 'ATTACKER_NOT_FOUND'
  const invalidAttacker = validateCombatUnit(attacker)
  if (invalidAttacker !== null) return invalidAttacker
  const attackIds = request.attacks.map((attack) => attack.attackId)
  if (duplicateValue(attackIds) || attackIds.some((attackId) => (
    state.resolutionIds.attackIds.includes(attackId)
  ))) return 'ATTACK_ID_ALREADY_USED'

  const damageEventIds = collectDamageEventIds(request.attacks)
  if (duplicateValue(damageEventIds) || damageEventIds.some((damageEventId) => (
    state.resolutionIds.damageEventIds.includes(damageEventId)
  ))) return 'DAMAGE_EVENT_ID_ALREADY_USED'

  for (const attack of request.attacks) {
    if (attack.damageType !== DamageType.Normal
      && attack.damageType !== DamageType.ShieldValue) {
      return 'INVALID_DAMAGE_TYPE'
    }
    if (!attackNumbersAreValid(attack)) return 'INVALID_NUMERIC_INPUT'
    const targetIds = attack.targets.map((target) => target.targetId)
    if (duplicateValue(targetIds)) return 'DUPLICATE_TARGET_ID'
    for (const targetId of targetIds) {
      const target = state.units.find((unit) => unit.id === targetId)
      if (target === undefined) return 'TARGET_NOT_FOUND'
      const invalidTarget = validateCombatUnit(target)
      if (invalidTarget !== null) return invalidTarget
      if (!target.alive || (!target.hasInfiniteHealth && target.currentHealth <= 0)) {
        return 'TARGET_INVALID_BEFORE_SKILL_START'
      }
    }
  }
  return null
}

function replaceUnit(
  units: readonly UnitState[],
  replacement: UnitState,
): readonly UnitState[] {
  return units.map((unit) => unit.id === replacement.id ? replacement : unit)
}

function createDamageEvent(
  request: SkillResolutionRequest,
  attack: AttackRequest,
  target: AttackTargetRequest,
  rawValue: number,
  resolvedValue: number,
  critical: boolean,
  shieldAbsorbed: number,
  healthLost: number,
  remainingShield: number,
  remainingHealth: number,
  causedDeath: boolean,
  targetWasAlreadyDead: boolean,
): DamageEvent {
  return {
    eventId: target.damageEventId,
    attackId: attack.attackId,
    skillExecutionId: request.skillExecutionId,
    sourceUnitId: request.casterId,
    targetUnitId: target.targetId,
    damageType: attack.damageType,
    rawValue,
    resolvedValue,
    critical,
    shieldAbsorbed,
    healthLost,
    remainingShield,
    remainingHealth,
    causedDeath,
    targetWasAlreadyDead,
  }
}

function appendDamageEvents(
  events: BattleEvent[],
  damage: DamageEvent,
  attackId: AttackId,
): void {
  events.push({ type: 'DAMAGE_CALCULATED', damage })
  if (damage.shieldAbsorbed > 0) {
    events.push({
      type: 'SHIELD_ABSORBED',
      skillExecutionId: damage.skillExecutionId,
      attackId,
      damageEventId: damage.eventId,
      targetId: damage.targetUnitId,
      amount: damage.shieldAbsorbed,
      remainingShield: damage.remainingShield,
    })
  }
  if (damage.healthLost > 0) {
    events.push({
      type: 'HEALTH_LOST',
      skillExecutionId: damage.skillExecutionId,
      attackId,
      damageEventId: damage.eventId,
      targetId: damage.targetUnitId,
      amount: damage.healthLost,
      remainingHealth: damage.remainingHealth,
      targetWasAlreadyDead: damage.targetWasAlreadyDead,
    })
  }
  if (damage.causedDeath) {
    events.push({
      type: 'UNIT_DIED',
      skillExecutionId: damage.skillExecutionId,
      attackId,
      damageEventId: damage.eventId,
      unitId: damage.targetUnitId,
    })
  }
}

function uniqueTargetIds(attacks: readonly AttackRequest[]): readonly UnitId[] {
  const result: UnitId[] = []
  for (const attack of attacks) {
    for (const target of attack.targets) {
      if (!result.includes(target.targetId)) result.push(target.targetId)
    }
  }
  return result
}

export function resolveSkillTransaction(
  state: BattleState,
  request: SkillResolutionRequest,
): SkillResolutionResult {
  const invalid = validateRequest(state, request)
  if (invalid !== null) return failure(state, invalid)

  let units = state.units
  let rngState: RandomState = state.rngState
  let skillContext: SkillContext = {
    skillExecutionId: request.skillExecutionId,
    actionId: request.actionId,
    casterId: request.casterId,
    skillId: request.skillId,
    branchId: null,
    targetIds: uniqueTargetIds(request.attacks),
    perTargetTriggerLocks: [],
    globalTriggerLocks: [],
  }
  const events: BattleEvent[] = [{
    type: 'SKILL_RESOLUTION_STARTED',
    skillExecutionId: request.skillExecutionId,
    actionId: request.actionId,
    skillId: request.skillId,
    casterId: request.casterId,
  }]

  try {
    for (const [attackIndex, attack] of request.attacks.entries()) {
      const snapshot = createPositionProtectionSnapshot(
        units,
        attack.targets.map((target) => target.targetId),
      )
      const attackContext: AttackContext = {
        attackId: attack.attackId,
        skillExecutionId: request.skillExecutionId,
        attackerId: request.casterId,
        attackIndex,
        damageType: attack.damageType,
        targetIds: attack.targets.map((target) => target.targetId),
        targets: attack.targets.map((target) => ({
          targetId: target.targetId,
          damageEventId: target.damageEventId,
          hit: target.hit ?? true,
          lockedAtSkillStart: true,
        })),
        protectionSnapshot: snapshot,
      }
      events.push({ type: 'ATTACK_STARTED', context: attackContext })

      for (const targetRequest of attack.targets) {
        if (!(targetRequest.hit ?? true)) continue
        const target = units.find((unit) => unit.id === targetRequest.targetId)
        if (target === undefined) return failure(state, 'TARGET_NOT_FOUND')
        const protection = getPositionProtectionReduction(
          snapshot,
          targetRequest.targetId,
        )
        const reductions = [
          ...target.normalDamageReductionSources.map((source) => source.reduction),
          ...(targetRequest.additionalReductionSources ?? []),
          ...(protection === 0 ? [] : [protection]),
        ]
        let rawValue: number
        let resolvedValue: number
        let critical = false

        if (attack.damageType === DamageType.Normal) {
          const calculation = calculateNormalDamage({
            effectiveAttack: attack.effectiveAttack,
            multiplier: attack.multiplier,
            fixedDamage: attack.fixedDamage,
            criticalRate: attack.criticalRate,
            criticalDamage: attack.criticalDamage,
            normalDamageIncrease: attack.normalDamageIncrease,
            reductionSources: reductions,
          }, rngState)
          if (!calculation.ok) {
            return failure(state, 'INVALID_NUMERIC_INPUT')
          }
          rngState = calculation.rngState
          rawValue = calculation.rawValue
          resolvedValue = calculation.resolvedValue
          critical = calculation.critical
          events.push({
            type: 'CRITICAL_ROLLED',
            skillExecutionId: request.skillExecutionId,
            attackId: attack.attackId,
            targetId: targetRequest.targetId,
            originalRate: attack.criticalRate,
            probability: calculation.criticalRateForRoll,
            critical,
            rngConsumed: calculation.rngConsumed,
          })
        } else {
          const calculation = calculateShieldValueDamage({
            baseValue: attack.baseValue,
            normalDamageIncrease: attack.normalDamageIncrease,
            reductionSources: reductions,
          })
          if (!calculation.ok) {
            return failure(state, 'INVALID_NUMERIC_INPUT')
          }
          resolvedValue = calculation.resolvedValue
          rawValue = calculation.rawValue
        }

        const applied = calculateShieldedDamage({
          currentHealth: target.currentHealth,
          currentShield: target.shield,
          hasInfiniteHealth: target.hasInfiniteHealth,
          alive: target.alive,
          resolvedDamage: resolvedValue,
        })
        if (!applied.ok) return failure(state, 'INVALID_SHIELD_CALCULATION')
        units = replaceUnit(units, {
          ...target,
          shield: applied.remainingShield,
          currentHealth: applied.remainingHealth,
          alive: applied.causedDeath ? false : target.alive,
        })
        const damage = createDamageEvent(
          request,
          attack,
          targetRequest,
          rawValue,
          resolvedValue,
          critical,
          applied.shieldAbsorbed,
          applied.healthLost,
          applied.remainingShield,
          applied.remainingHealth,
          applied.causedDeath,
          applied.targetWasAlreadyDead,
        )
        appendDamageEvents(events, damage, attack.attackId)

        if (targetRequest.extraDamage !== undefined) {
          const extraCalculation = calculateExtraDamage(
            targetRequest.extraDamage.value,
          )
          if (!extraCalculation.ok) {
            return failure(state, 'INVALID_NUMERIC_INPUT')
          }
          const extraValue = extraCalculation.resolvedValue
          if (extraValue === 0) continue
          const lockId = targetRequest.extraDamage.triggerLockId
          if (lockId !== undefined) {
            const lockResult = acquirePerTargetTriggerLock(
              skillContext,
              lockId,
              targetRequest.targetId,
            )
            if (!lockResult.acquired) continue
            skillContext = lockResult.context
          }
          const currentTarget = units.find(
            (unit) => unit.id === targetRequest.targetId,
          )
          if (currentTarget === undefined) return failure(state, 'TARGET_NOT_FOUND')
          const extraApplied = calculateDirectHealthDamage({
            currentHealth: currentTarget.currentHealth,
            hasInfiniteHealth: currentTarget.hasInfiniteHealth,
            alive: currentTarget.alive,
            resolvedDamage: extraValue,
          })
          if (!extraApplied.ok) {
            return failure(state, 'INVALID_SHIELD_CALCULATION')
          }
          units = replaceUnit(units, {
            ...currentTarget,
            currentHealth: extraApplied.remainingHealth,
            alive: extraApplied.causedDeath ? false : currentTarget.alive,
          })
          const extraDamage: DamageEvent = {
            eventId: targetRequest.extraDamage.damageEventId,
            attackId: attack.attackId,
            skillExecutionId: request.skillExecutionId,
            sourceUnitId: request.casterId,
            targetUnitId: targetRequest.targetId,
            damageType: DamageType.Extra,
            rawValue: targetRequest.extraDamage.value,
            resolvedValue: extraValue,
            critical: false,
            shieldAbsorbed: 0,
            healthLost: extraApplied.healthLost,
            remainingShield: currentTarget.shield,
            remainingHealth: extraApplied.remainingHealth,
            causedDeath: extraApplied.causedDeath,
            targetWasAlreadyDead: extraApplied.targetWasAlreadyDead,
          }
          events.push({ type: 'EXTRA_DAMAGE_APPLIED', damage: extraDamage })
          if (extraDamage.causedDeath) {
            events.push({
              type: 'UNIT_DIED',
              skillExecutionId: request.skillExecutionId,
              attackId: attack.attackId,
              damageEventId: extraDamage.eventId,
              unitId: extraDamage.targetUnitId,
            })
          }
        }
      }
      events.push({
        type: 'ATTACK_COMPLETED',
        skillExecutionId: request.skillExecutionId,
        attackId: attack.attackId,
      })
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return failure(state, 'RANDOM_SOURCE_EXHAUSTED')
    }
    throw error
  }

  events.push({
    type: 'SKILL_RESOLUTION_COMPLETED',
    skillExecutionId: request.skillExecutionId,
    actionId: request.actionId,
    skillId: request.skillId,
    casterId: request.casterId,
  })
  const nextState: BattleState = {
    ...state,
    units,
    activeSkill: null,
    completedSkillResolution: {
      skillExecutionId: request.skillExecutionId,
      actionId: request.actionId,
      personalTurnId: request.personalTurnId,
      sequenceId: request.sequenceId,
    },
    resolutionIds: {
      skillExecutionIds: [
        ...state.resolutionIds.skillExecutionIds,
        request.skillExecutionId,
      ],
      attackIds: [
        ...state.resolutionIds.attackIds,
        ...request.attacks.map((attack) => attack.attackId),
      ],
      damageEventIds: [
        ...state.resolutionIds.damageEventIds,
        ...collectDamageEventIds(request.attacks),
      ],
    },
    rngState,
    events: [...state.events, ...events],
  }
  return { ok: true, state: nextState, events }
}
