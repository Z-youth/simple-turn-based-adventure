import {
  ActionLifecycleStage,
  BattlePhase,
  DamageType,
  PersonalTurnPhase,
  UnitSystem,
} from './enums'
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
  SkillEffectRequest,
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
import {
  validateBattleStateUnits,
  validateCombatUnit,
} from './combatValidation'
import type { ResourceErrorCode } from './resources'
import {
  gainResource,
  spendResource,
  unitResourcesMatchConfiguration,
} from './resources'
import type { StatusErrorCode } from './statusEngine'
import {
  addStatusToBattle,
  removeBattleStatus,
} from './statusEngine'
import type { SpecialCounterErrorCode } from './specialCounters'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
} from './specialCounters'
import {
  createMomentumPressureDamageEventId,
  getMomentumPressureExtraDamage,
  MOMENTUM_PRESSURE_TRIGGER_LOCK_ID,
} from './momentumPressure'

export type SkillResolutionErrorCode = CombatUnitValidationErrorCode
  | ResourceErrorCode
  | StatusErrorCode
  | SpecialCounterErrorCode
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
  | 'RESOURCE_PAYMENT_NOT_COMPLETED'
  | 'TEMPORARY_ATTRIBUTE_OWNER_NOT_FOUND'
  | 'TEMPORARY_ATTRIBUTE_OWNER_DEAD'
  | 'INVALID_TEMPORARY_ATTRIBUTE_VALUE'

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
  includeMomentumPressure: boolean,
): readonly DamageEventId[] {
  return attacks.flatMap((attack) => attack.targets.flatMap((target) => {
    const result = target.extraDamage === undefined
      ? [target.damageEventId]
      : [target.damageEventId, target.extraDamage.damageEventId]
    return includeMomentumPressure && (target.hit ?? true)
      ? [...result, createMomentumPressureDamageEventId(target.damageEventId)]
      : result
  }))
}

function orderedEffects(
  request: SkillResolutionRequest,
): readonly SkillEffectRequest[] {
  return request.effects ?? request.attacks.map((attack) => ({
    kind: 'attack' as const,
    attack,
  }))
}

function orderedAttacks(
  request: SkillResolutionRequest,
): readonly AttackRequest[] {
  return orderedEffects(request).flatMap((effect) => (
    effect.kind === 'attack' ? [effect.attack] : []
  ))
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
  if (state.activeAction.stage !== ActionLifecycleStage.SkillResolution) {
    return 'RESOURCE_PAYMENT_NOT_COMPLETED'
  }
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
  const payment = state.completedResourcePayment
  if (
    payment === null
    || payment.skillExecutionId !== request.skillExecutionId
    || payment.actionId !== request.actionId
    || payment.personalTurnId !== request.personalTurnId
    || payment.sequenceId !== request.sequenceId
    || payment.payerUnitId !== request.casterId
    || !state.resourcePaymentRegistry.paidSkillExecutionIds.includes(
      request.skillExecutionId,
    )
  ) return 'RESOURCE_PAYMENT_NOT_COMPLETED'
  if (state.resolutionIds.skillExecutionIds.includes(request.skillExecutionId)) {
    return 'SKILL_EXECUTION_ID_ALREADY_USED'
  }

  if (validateRandomState(state.rngState) !== null) return 'INVALID_RANDOM_STATE'

  const attacker = state.units.find((unit) => unit.id === request.casterId)
  if (attacker === undefined) return 'ATTACKER_NOT_FOUND'
  const invalidAttacker = validateCombatUnit(attacker)
  if (invalidAttacker !== null) return invalidAttacker
  if (!unitResourcesMatchConfiguration(
    attacker,
    state.resourceConfiguration,
  )) return 'INVALID_UNIT_RESOURCE_STATE'
  const attacks = orderedAttacks(request)
  const attackIds = attacks.map((attack) => attack.attackId)
  if (duplicateValue(attackIds) || attackIds.some((attackId) => (
    state.resolutionIds.attackIds.includes(attackId)
  ))) return 'ATTACK_ID_ALREADY_USED'

  const damageEventIds = collectDamageEventIds(
    attacks,
    attacker.system === UnitSystem.Momentum && attacker.momentumPressure > 0,
  )
  if (duplicateValue(damageEventIds) || damageEventIds.some((damageEventId) => (
    state.resolutionIds.damageEventIds.includes(damageEventId)
  ))) return 'DAMAGE_EVENT_ID_ALREADY_USED'

  for (const attack of attacks) {
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
      if (!unitResourcesMatchConfiguration(
        target,
        state.resourceConfiguration,
      )) return 'INVALID_UNIT_RESOURCE_STATE'
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
    extraDamageSource: null,
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
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  const invalid = validateRequest(state, request)
  if (invalid !== null) return failure(state, invalid)

  const effects = orderedEffects(request)
  const attacks = orderedAttacks(request)
  let units = state.units
  let statusBatches = state.statusBatches
  let statusAcquisitionOrders = state.statusAcquisitionOrders
  let rngState: RandomState = state.rngState
  let skillContext: SkillContext = {
    skillExecutionId: request.skillExecutionId,
    actionId: request.actionId,
    casterId: request.casterId,
    skillId: request.skillId,
    branchId: request.branchId ?? null,
    targetIds: uniqueTargetIds(attacks),
    perTargetTriggerLocks: [],
    globalTriggerLocks: [],
  }
  const events: BattleEvent[] = [{
    type: 'SKILL_RESOLUTION_STARTED',
    skillExecutionId: request.skillExecutionId,
    actionId: request.actionId,
    skillId: request.skillId,
    casterId: request.casterId,
    ...(skillContext.branchId === null ? {} : { context: skillContext }),
  }]

  try {
    let attackIndex = 0
    for (const effect of effects) {
      const effectState = (): BattleState => ({
        ...state,
        units,
        statusBatches,
        statusAcquisitionOrders,
        activeSkill: skillContext,
        rngState,
        events: [...state.events, ...events],
      })

      if (effect.kind === 'resource') {
        const change = effect.operation === 'gain' ? gainResource : spendResource
        const changed = change(effectState(), {
          unitId: effect.unitId,
          resourceType: effect.resourceType,
          amount: effect.amount,
          reason: effect.reason,
          sourceId: effect.sourceId === undefined
            ? String(request.skillId)
            : effect.sourceId,
          actionId: request.actionId,
          personalTurnId: request.personalTurnId,
          sequenceId: request.sequenceId,
          skillExecutionId: request.skillExecutionId,
          resourceTransactionId:
            state.completedResourcePayment?.resourceTransactionId ?? null,
        })
        if (!changed.ok) return failure(state, changed.reason)
        units = changed.state.units
        events.push(...changed.events)
        continue
      }

      if (effect.kind === 'status') {
        const changed = effect.operation === 'add'
          ? addStatusToBattle(effectState(), effect.status)
          : removeBattleStatus(effectState(), {
              ownerUnitId: effect.ownerUnitId,
              mode: effect.mode,
            })
        if (!changed.ok) return failure(state, changed.reason)
        statusBatches = changed.state.statusBatches
        statusAcquisitionOrders = changed.state.statusAcquisitionOrders
        events.push(...changed.events)
        continue
      }

      if (effect.kind === 'specialCounter') {
        const change = effect.operation === 'increase'
          ? increaseSpecialCounter
          : decreaseSpecialCounter
        const changed = change(effectState(), {
          unitId: effect.unitId,
          counterId: effect.counterId,
          amount: effect.amount,
          actionId: request.actionId,
          personalTurnId: request.personalTurnId,
          sequenceId: request.sequenceId,
          skillExecutionId: request.skillExecutionId,
        })
        if (!changed.ok) return failure(state, changed.reason)
        units = changed.state.units
        events.push(...changed.events)
        continue
      }

      if (effect.kind === 'temporaryAttribute') {
        const owner = units.find((unit) => unit.id === effect.unitId)
        if (owner === undefined) {
          return failure(state, 'TEMPORARY_ATTRIBUTE_OWNER_NOT_FOUND')
        }
        if (!owner.alive
          || (!owner.hasInfiniteHealth && owner.currentHealth <= 0)) {
          return failure(state, 'TEMPORARY_ATTRIBUTE_OWNER_DEAD')
        }
        if (!Number.isFinite(effect.value)) {
          return failure(state, 'INVALID_TEMPORARY_ATTRIBUTE_VALUE')
        }
        units = replaceUnit(units, {
          ...owner,
          attackModifiers: [
            ...owner.attackModifiers,
            {
              sourceId: effect.sourceId,
              value: effect.value,
              expiresAtTurnEnd: effect.expiresAtTurnEnd,
            },
          ],
        })
        events.push({
          type: 'TEMPORARY_ATTRIBUTE_CHANGED',
          skillExecutionId: request.skillExecutionId,
          unitId: effect.unitId,
          attribute: effect.attribute,
          sourceId: effect.sourceId,
          value: effect.value,
          expiresAtTurnEnd: effect.expiresAtTurnEnd,
        })
        continue
      }

      const attack = effect.attack
      const snapshot = createPositionProtectionSnapshot(
        units,
        attack.targets.map((target) => target.targetId),
      )
      const currentAttacker = units.find((unit) => unit.id === request.casterId)
      if (currentAttacker === undefined) return failure(state, 'ATTACKER_NOT_FOUND')
      const momentumPressureSnapshot = currentAttacker.system === UnitSystem.Momentum
        ? currentAttacker.momentumPressure
        : 0
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
        momentumPressureSnapshot,
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
          alive: applied.alive,
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
            alive: extraApplied.alive,
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
            extraDamageSource: 'generic',
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

        const pressureExtraValue = getMomentumPressureExtraDamage(
          momentumPressureSnapshot,
        )
        if (!Number.isFinite(pressureExtraValue)) {
          return failure(state, 'INVALID_NUMERIC_INPUT')
        }
        if (pressureExtraValue > 0) {
          const lockResult = acquirePerTargetTriggerLock(
            skillContext,
            MOMENTUM_PRESSURE_TRIGGER_LOCK_ID,
            targetRequest.targetId,
          )
          if (lockResult.acquired) {
            skillContext = lockResult.context
            const currentTarget = units.find(
              (unit) => unit.id === targetRequest.targetId,
            )
            if (currentTarget === undefined) {
              return failure(state, 'TARGET_NOT_FOUND')
            }
            const pressureDamageEventId = createMomentumPressureDamageEventId(
              targetRequest.damageEventId,
            )
            const pressureApplied = calculateDirectHealthDamage({
              currentHealth: currentTarget.currentHealth,
              hasInfiniteHealth: currentTarget.hasInfiniteHealth,
              alive: currentTarget.alive,
              resolvedDamage: pressureExtraValue,
            })
            if (!pressureApplied.ok) {
              return failure(state, 'INVALID_SHIELD_CALCULATION')
            }
            units = replaceUnit(units, {
              ...currentTarget,
              currentHealth: pressureApplied.remainingHealth,
              alive: pressureApplied.alive,
            })
            const pressureDamage: DamageEvent = {
              eventId: pressureDamageEventId,
              attackId: attack.attackId,
              skillExecutionId: request.skillExecutionId,
              sourceUnitId: request.casterId,
              targetUnitId: targetRequest.targetId,
              damageType: DamageType.Extra,
              rawValue: pressureExtraValue,
              resolvedValue: pressureExtraValue,
              critical: false,
              shieldAbsorbed: 0,
              healthLost: pressureApplied.healthLost,
              remainingShield: currentTarget.shield,
              remainingHealth: pressureApplied.remainingHealth,
              causedDeath: pressureApplied.causedDeath,
              targetWasAlreadyDead: pressureApplied.targetWasAlreadyDead,
              extraDamageSource: 'momentumPressure',
            }
            events.push({
              type: 'MOMENTUM_PRESSURE_TRIGGERED',
              skillExecutionId: request.skillExecutionId,
              attackId: attack.attackId,
              damageEventId: pressureDamageEventId,
              sourceUnitId: request.casterId,
              targetUnitId: targetRequest.targetId,
              momentumPressure: momentumPressureSnapshot,
              extraDamage: pressureExtraValue,
            })
            events.push({ type: 'EXTRA_DAMAGE_APPLIED', damage: pressureDamage })
            if (pressureDamage.causedDeath) {
              events.push({
                type: 'UNIT_DIED',
                skillExecutionId: request.skillExecutionId,
                attackId: attack.attackId,
                damageEventId: pressureDamage.eventId,
                unitId: pressureDamage.targetUnitId,
              })
            }
          }
        }
      }
      events.push({
        type: 'ATTACK_COMPLETED',
        skillExecutionId: request.skillExecutionId,
        attackId: attack.attackId,
      })
      attackIndex += 1
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
    statusBatches,
    statusAcquisitionOrders,
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
        ...attacks.map((attack) => attack.attackId),
      ],
      damageEventIds: [
        ...state.resolutionIds.damageEventIds,
        ...collectDamageEventIds(
          attacks,
          state.units.some((unit) => (
            unit.id === request.casterId
            && unit.system === UnitSystem.Momentum
            && unit.momentumPressure > 0
          )),
        ),
      ],
    },
    rngState,
    events: [...state.events, ...events],
  }
  return { ok: true, state: nextState, events }
}
