import { describe, expect, it } from 'vitest'
import {
  DamageType,
  Position,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  StatusBatchId,
  StatusId,
} from '../game/core/identifiers'
import type {
  NormalAttackRequest,
  SkillResolutionRequest,
} from '../game/core/attacks'
import type { BattleState } from '../game/core/contexts'
import {
  completeBattleAction,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import {
  resolveResourcePaidSkillTransaction,
  type ResourcePaymentRequest,
} from '../game/core/resourceTransaction'
import { resolveSkillTransaction } from '../game/core/resolutionTransaction'
import {
  createDefaultResourceConfiguration,
  ResourceType,
} from '../game/core/resources'
import { createFixedSequenceRandomState } from '../game/core/rng'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import type { StatusBatch } from '../game/core/statuses'

const actionId = 'action:resource' as ActionId
const skillExecutionId = 'skill-execution:resource' as SkillExecutionId
const skillId = 'skill:resource' as SkillId

function setup(overrides = {}) {
  const awaiting = startBattleSequence(createBattleState([
    createUnit('actor', {
      speed: 200,
      position: Position.Front1,
      energy: 5,
      momentum: 8,
      ...overrides,
    }),
    createUnit('target', { speed: 1, position: Position.Front2 }),
  ]))
  if (!awaiting.ok || awaiting.state.personalTurn === null) {
    throw new Error('Could not start resource test turn')
  }
  const resolving = startBattleAction(awaiting.state, {
    actionId,
    actorId: unitId('actor'),
    skillExecutionId,
    endsTurn: false,
  })
  if (!resolving.ok) throw new Error('Could not start resource test action')
  return { awaiting: awaiting.state, resolving: resolving.state }
}

function payment(
  state: BattleState,
  costs = [
    { resourceType: ResourceType.Energy, amount: 2 },
    { resourceType: ResourceType.Momentum, amount: 3 },
  ],
  transaction = 'resource-transaction:1',
): ResourcePaymentRequest {
  if (state.personalTurn === null || state.activeAction === null) {
    throw new Error('Missing active action')
  }
  return {
    resourceTransactionId: transaction as ResourceTransactionId,
    actionId,
    personalTurnId: state.personalTurn.personalTurnId,
    sequenceId: state.activeAction.sequenceId,
    skillExecutionId,
    payerUnitId: unitId('actor'),
    costs,
  }
}

function skill(
  state: BattleState,
  overrides: Partial<NormalAttackRequest> = {},
): SkillResolutionRequest {
  if (state.personalTurn === null || state.activeAction === null) {
    throw new Error('Missing active action')
  }
  const attack: NormalAttackRequest = {
    attackId: 'attack:resource' as AttackId,
    damageType: DamageType.Normal,
    effectiveAttack: 10,
    multiplier: 1,
    fixedDamage: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    targets: [{
      targetId: unitId('target'),
      damageEventId: 'damage:resource' as DamageEventId,
    }],
    ...overrides,
  }
  return {
    actionId,
    personalTurnId: state.personalTurn.personalTurnId,
    sequenceId: state.activeAction.sequenceId,
    skillExecutionId,
    skillId,
    casterId: unitId('actor'),
    attacks: [attack],
  }
}

function rollbackStatus(): StatusBatch {
  return {
    batchId: 'batch:transaction-rollback' as StatusBatchId,
    statusId: 'status:transaction-rollback' as StatusId,
    ownerUnitId: unitId('actor'),
    sourceUnitId: unitId('actor'),
    stacks: 2,
    effect: { calculation: 'total', value: 3 },
    remainingOwnerTurns: 2,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: 'action:before-transaction',
    acquisitionOrder: 1,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: false,
    canBeDispelled: true,
  }
}

describe('resource payment lifecycle', () => {
  it('stops a skill action at the real payment boundary', () => {
    const { resolving } = setup()

    expect(resolving.activeAction?.stage).toBe('resourceValidationAndPayment')
    expect(resolving.events.at(-1)).toMatchObject({
      type: 'ACTION_STAGE_REACHED',
      stage: 'resourceValidationAndPayment',
    })
    expect(resolving.events.some((event) => (
      event.type === 'ACTION_STAGE_REACHED'
      && event.stage === 'skillResolution'
    ))).toBe(false)
  })

  it('rejects direct skill resolution before payment', () => {
    const { resolving } = setup()
    const result = resolveSkillTransaction(resolving, skill(resolving))

    expect(result).toEqual({
      ok: false,
      state: resolving,
      events: [],
      reason: 'RESOURCE_PAYMENT_NOT_COMPLETED',
    })
  })

  it('atomically pays multiple resources and resolves the skill', () => {
    const { resolving } = setup()
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 3, momentum: 5 })
    expect(result.events.filter((event) => event.type === 'RESOURCE_SPENT'))
      .toEqual([
        expect.objectContaining({ resourceType: 'energy', amount: 2 }),
        expect.objectContaining({ resourceType: 'momentum', amount: 3 }),
      ])
    expect(result.events.map((event) => event.type).indexOf('RESOURCE_SPENT'))
      .toBeLessThan(result.events.map((event) => event.type)
        .indexOf('SKILL_RESOLUTION_STARTED'))
    expect(result.state.completedResourcePayment).not.toBeNull()
    expect(result.state.completedSkillResolution).not.toBeNull()
    expect(result.state.rngState.cursor).toBe(resolving.rngState.cursor)
  })

  it('executes declared resource, status, temporary attribute, and attack effects in order', () => {
    const { resolving } = setup()
    const request = skill(resolving)
    const attack = request.attacks[0]
    const status = rollbackStatus()
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, []),
      {
        ...request,
        effects: [
          {
            kind: 'resource',
            operation: 'gain',
            unitId: unitId('actor'),
            resourceType: ResourceType.Energy,
            amount: 2,
            reason: 'ordered-effect-test',
          },
          { kind: 'status', operation: 'add', status },
          {
            kind: 'temporaryAttribute',
            attribute: 'attack',
            unitId: unitId('actor'),
            sourceId: skillId,
            value: 2,
            expiresAtTurnEnd: true,
          },
          { kind: 'attack', attack },
        ],
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const orderedMarkers = result.events.flatMap((event) => {
      if (event.type === 'RESOURCE_GAINED') return ['resource']
      if (event.type === 'STATUS_ACQUIRED') return ['status']
      if (event.type === 'TEMPORARY_ATTRIBUTE_CHANGED') return ['temporary']
      if (event.type === 'ATTACK_STARTED') return ['attack']
      return []
    })
    expect(orderedMarkers).toEqual([
      'resource',
      'status',
      'temporary',
      'attack',
    ])
    expect(result.state.statusBatches).toEqual([status])
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({
        energy: 7,
        attackModifiers: [{
          sourceId: skillId,
          value: 2,
          expiresAtTurnEnd: true,
        }],
      })
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 90 })
  })

  it('records a selected branch in the active skill context', () => {
    const { resolving } = setup()
    const branchId = 'branch:ordered-effect' as SkillBranchId
    const request = skill(resolving)
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, []),
      {
        ...request,
        branchId,
        effects: [{ kind: 'attack', attack: request.attacks[0] }],
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.find((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
    ))).toMatchObject({
      context: {
        skillExecutionId,
        skillId,
        branchId,
        targetIds: [unitId('target')],
      },
    })
  })

  it('aggregates duplicate costs before paying in fixed resource order', () => {
    const { resolving } = setup()
    const costs = [
      { resourceType: ResourceType.Momentum, amount: 1 },
      { resourceType: ResourceType.Energy, amount: 1 },
      { resourceType: ResourceType.Momentum, amount: 2 },
      { resourceType: ResourceType.Energy, amount: 1 },
    ]
    const originalItems = [...costs]
    const originalContents = costs.map((cost) => ({ ...cost }))
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, costs),
      skill(resolving),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const spent = result.events.flatMap((event) => event.type === 'RESOURCE_SPENT'
      ? [[event.resourceType, event.amount] as const]
      : [])
    expect(spent).toEqual([
      ['energy', 2],
      ['momentum', 3],
    ])
    expect(costs).toEqual(originalContents)
    expect(costs[0]).toBe(originalItems[0])
    expect(costs[1]).toBe(originalItems[1])
  })

  it('accepts a no-cost skill but still records payment completion', () => {
    const { resolving } = setup()
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, []),
      skill(resolving),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.some((event) => event.type === 'RESOURCE_SPENT'))
      .toBe(false)
    expect(result.state.completedResourcePayment?.skillExecutionId)
      .toBe(skillExecutionId)
  })

  it('returns the exact input state when any resource is insufficient before payment', () => {
    const { resolving } = setup()
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, [
        { resourceType: ResourceType.Energy, amount: 2 },
        { resourceType: ResourceType.Momentum, amount: 99 },
      ]),
      skill(resolving),
    )

    expect(result).toEqual({
      ok: false,
      state: resolving,
      events: [],
      reason: 'INSUFFICIENT_RESOURCE',
    })
    expect(result.state.personalTurn?.phase).toBe('resolvingAction')
    expect(result.state.personalTurn?.countedActionCount).toBe(0)
    expect(result.state.activeAction).toBe(resolving.activeAction)
    expect(result.state.rngState).toBe(resolving.rngState)
  })

  it('preserves the current action unchanged after payment validation failure', () => {
    const { resolving } = setup()
    const failed = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, [{ resourceType: ResourceType.Energy, amount: 99 }]),
      skill(resolving),
    )
    expect(failed).toEqual({
      ok: false,
      state: resolving,
      events: [],
      reason: 'INSUFFICIENT_RESOURCE',
    })
    const retry = startBattleAction(failed.state, {
      actionId: 'action:retry' as ActionId,
      actorId: unitId('actor'),
      endsTurn: false,
    })

    expect(retry).toEqual({
      ok: false,
      state: resolving,
      events: [],
      reason: 'BATTLE_NOT_READY_FOR_ACTION',
    })
  })

  it.each([
    ['actionId', 'RESOURCE_ACTION_ID_MISMATCH'],
    ['personalTurnId', 'RESOURCE_PERSONAL_TURN_ID_MISMATCH'],
    ['sequenceId', 'RESOURCE_SEQUENCE_ID_MISMATCH'],
    ['skillExecutionId', 'RESOURCE_SKILL_EXECUTION_ID_MISMATCH'],
    ['payerUnitId', 'RESOURCE_PAYER_ID_MISMATCH'],
  ] as const)('rejects mismatched %s before payment', (field, reason) => {
    const { resolving } = setup()
    const original = payment(resolving)
    const mismatched = {
      ...original,
      [field]: field === 'payerUnitId'
        ? unitId('target')
        : `wrong:${field}`,
    } as ResourcePaymentRequest
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      mismatched,
      skill(resolving),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe(reason)
      expect(result.state).toBe(resolving)
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid payment amount %s',
    (amount) => {
      const { resolving } = setup()
      const result = resolveResourcePaidSkillTransaction(
        resolving,
        payment(resolving, [{ resourceType: ResourceType.Energy, amount }]),
        skill(resolving),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('INVALID_RESOURCE_AMOUNT')
    },
  )

  it('rejects aggregate cost overflow', () => {
    const { resolving } = setup({ energy: Number.MAX_SAFE_INTEGER })
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, [
        { resourceType: ResourceType.Energy, amount: Number.MAX_SAFE_INTEGER },
        { resourceType: ResourceType.Energy, amount: 1 },
      ]),
      skill(resolving),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RESOURCE_COST_TOTAL_OVERFLOW')
  })

  it('rejects a dead payer without clearing existing resources', () => {
    const { awaiting, resolving } = setup()
    const deadState = {
      ...resolving,
      units: resolving.units.map((unit) => unit.id === unitId('actor')
        ? { ...unit, alive: false, currentHealth: 0 }
        : unit),
    }
    const result = resolveResourcePaidSkillTransaction(
      deadState,
      payment(deadState),
      skill(deadState),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RESOURCE_OWNER_DEAD')
    expect(awaiting.units[0]).toMatchObject({ energy: 5, momentum: 8 })
  })

  it('rejects default negative energy before skill resolution', () => {
    const { resolving } = setup({ energy: -1 })
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, []),
      skill(resolving),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RESOURCE_VALUE_OUT_OF_RANGE')
  })

  it('rejects forged fixed resource configuration before payment', () => {
    const { resolving } = setup()
    const defaults = createDefaultResourceConfiguration()
    const forged = {
      ...resolving,
      resourceConfiguration: {
        resources: defaults.resources.map((config) => (
          config.resourceType === ResourceType.Momentum
            ? { ...config, maximum: 0 }
            : config
        )),
      },
    }
    const result = resolveResourcePaidSkillTransaction(
      forged,
      payment(forged),
      skill(forged),
    )

    expect(result).toEqual({
      ok: false,
      state: forged,
      events: [],
      reason: 'INVALID_RESOURCE_CONFIGURATION',
    })
    expect(result.state.events).toBe(forged.events)
    expect(result.state.rngState).toBe(forged.rngState)
    expect(result.state.units).toBe(forged.units)
  })

})

describe('payment and skill atomicity', () => {
  it('rolls payment and every earlier ordered effect back when a middle effect fails', () => {
    const initial = setup()
    const rng = createFixedSequenceRandomState([0.25])
    const awaiting = { ...initial.awaiting, rngState: rng }
    const resolving = {
      ...initial.resolving,
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const request = skill(resolving, { criticalRate: 0.5 })
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, [{ resourceType: ResourceType.Energy, amount: 1 }]),
      {
        ...request,
        effects: [
          {
            kind: 'resource',
            operation: 'gain',
            unitId: unitId('actor'),
            resourceType: ResourceType.Momentum,
            amount: 2,
            reason: 'ordered-effect-before-failure',
          },
          { kind: 'status', operation: 'add', status: rollbackStatus() },
          {
            kind: 'temporaryAttribute',
            attribute: 'attack',
            unitId: unitId('actor'),
            sourceId: skillId,
            value: 2,
            expiresAtTurnEnd: true,
          },
          { kind: 'attack', attack: request.attacks[0] },
          {
            kind: 'resource',
            operation: 'spend',
            unitId: unitId('actor'),
            resourceType: ResourceType.Energy,
            amount: 999,
            reason: 'ordered-effect-failure',
          },
        ],
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('INSUFFICIENT_RESOURCE')
    expect(result.state).toBe(awaiting)
    expect(result.events).toEqual([])
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.statusBatches).toBe(awaiting.statusBatches)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(rng)
    expect(result.state.rngState.cursor).toBe(0)
    expect(result.state.activeAction).toBeNull()
    expect(result.state.personalTurn?.startedActionIds).toEqual([])
    expect(result.state.resourcePaymentRegistry.resourceTransactionIds)
      .toEqual([])
    expect(result.state.resolutionIds.skillExecutionIds).toEqual([])
  })

  it('restores existing status batches with the complete action snapshot', () => {
    const initial = setup()
    const existingStatus = rollbackStatus()
    const rng = createFixedSequenceRandomState([])
    const awaiting = {
      ...initial.awaiting,
      statusBatches: [existingStatus],
      statusAcquisitionOrders: [existingStatus.acquisitionOrder],
      rngState: rng,
    }
    const resolving = {
      ...initial.resolving,
      statusBatches: awaiting.statusBatches,
      statusAcquisitionOrders: awaiting.statusAcquisitionOrders,
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving, { criticalRate: 0.5 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RANDOM_SOURCE_EXHAUSTED')
    expect(result.state).toBe(awaiting)
    expect(result.state.statusBatches).toBe(awaiting.statusBatches)
    expect(result.state.statusBatches).toEqual([existingStatus])
    expect(result.state.statusAcquisitionOrders)
      .toBe(awaiting.statusAcquisitionOrders)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(rng)
  })

  it('rolls payment back when the first target exhausts RNG', () => {
    const initial = setup()
    const rng = createFixedSequenceRandomState([])
    const awaiting = { ...initial.awaiting, rngState: rng }
    const resolving = {
      ...initial.resolving,
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving, { criticalRate: 0.5 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RANDOM_SOURCE_EXHAUSTED')
    expect(result.state).toBe(awaiting)
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(rng)
    expect(result.state.completedResourcePayment).toBeNull()
    expect(result.state.completedSkillResolution).toBeNull()
  })

  it('rolls payment, damage, events, and RNG back when a later attack fails', () => {
    const initial = setup()
    const resolving = {
      ...initial.resolving,
      rngState: createFixedSequenceRandomState([0.1, 0.9]),
      actionRollbackState: {
        ...initial.awaiting,
        rngState: createFixedSequenceRandomState([0.1, 0.9]),
      },
    }
    const failingSkill = skill(resolving)
    const baseAttack = failingSkill.attacks[0]
    if (baseAttack.damageType !== DamageType.Normal) return
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      {
        ...failingSkill,
        attacks: [
          { ...baseAttack, criticalRate: 0.5 },
          {
            ...baseAttack,
            attackId: 'attack:overflow' as AttackId,
            effectiveAttack: Number.MAX_VALUE,
            multiplier: 2,
            targets: [{
              targetId: unitId('target'),
              damageEventId: 'damage:overflow' as DamageEventId,
            }],
          },
        ],
      },
    )

    expect(result.ok).toBe(false)
    expect(result.state).toBe(resolving.actionRollbackState)
    expect(result.events).toEqual([])
    expect(result.state.rngState.cursor).toBe(0)
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 5, momentum: 8 })
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 100 })
  })

  it('retries with the same random result after atomic failure', () => {
    const initial = setup()
    const rng = createFixedSequenceRandomState([0.1])
    const awaiting = { ...initial.awaiting, rngState: rng }
    const resolving = {
      ...initial.resolving,
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const invalid = skill(resolving, {
      effectiveAttack: Number.MAX_VALUE,
      multiplier: 2,
      criticalRate: 0.5,
    })
    const first = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      invalid,
    )
    const second = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      invalid,
    )

    expect(first).toEqual(second)
    expect(first.state.rngState).toBe(rng)
  })

  it('rolls payment back when a later target exhausts RNG', () => {
    const initial = setup()
    const secondTarget = createUnit('second-target', {
      camp: 'enemy',
      position: null,
      speed: 0,
    })
    const rng = createFixedSequenceRandomState([0.1])
    const awaiting = {
      ...initial.awaiting,
      units: [...initial.awaiting.units, secondTarget],
      rngState: rng,
    }
    const resolving = {
      ...initial.resolving,
      units: [...initial.resolving.units, secondTarget],
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const request = skill(resolving, {
      criticalRate: 0.5,
      targets: [
        {
          targetId: unitId('target'),
          damageEventId: 'damage:first-target' as DamageEventId,
        },
        {
          targetId: unitId('second-target'),
          damageEventId: 'damage:second-target' as DamageEventId,
        },
      ],
    })
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      request,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RANDOM_SOURCE_EXHAUSTED')
    expect(result.state).toBe(awaiting)
    expect(result.state.rngState).toBe(rng)
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 5, momentum: 8 })
    expect(result.events).toEqual([])
  })

  it('rolls payment and normal damage back when generic extra damage fails', () => {
    const { awaiting, resolving } = setup()
    const request = skill(resolving, {
      targets: [{
        targetId: unitId('target'),
        damageEventId: 'damage:before-extra' as DamageEventId,
        extraDamage: {
          damageEventId: 'damage:extra-overflow' as DamageEventId,
          value: Number.MAX_VALUE,
        },
      }],
    })
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      request,
    )

    expect(result.ok).toBe(false)
    expect(result.state).toBe(awaiting)
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 5, momentum: 8 })
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 100 })
    expect(result.events).toEqual([])
  })

  it('rolls normal damage, pressure lock, payment, events, and RNG back when pressure damage overflows', () => {
    const initial = setup()
    const rng = createFixedSequenceRandomState([0.25])
    const awaiting = { ...initial.awaiting, rngState: rng }
    const resolving = {
      ...initial.resolving,
      units: initial.resolving.units.map((unit) => unit.id === unitId('actor')
        ? { ...unit, momentumPressure: Number.MAX_SAFE_INTEGER }
        : unit),
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving, { criticalRate: 0.5 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('INVALID_NUMERIC_INPUT')
    expect(result.state).toBe(awaiting)
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 5, momentum: 8, momentumPressure: 0 })
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 100, shield: 0 })
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(rng)
    expect(result.state.completedResourcePayment).toBeNull()
    expect(result.state.completedSkillResolution).toBeNull()
    expect(result.state).not.toHaveProperty('triggerLocks')
  })

  it('rejects an invalid RNG state before committing payment or skill events', () => {
    const initial = setup()
    const invalidRng = { kind: 'seeded' as const, seed: -1, cursor: 0 }
    const awaiting = { ...initial.awaiting, rngState: invalidRng }
    const resolving = {
      ...initial.resolving,
      rngState: invalidRng,
      actionRollbackState: awaiting,
    }
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving),
    )

    expect(result).toEqual({
      ok: false,
      state: awaiting,
      events: [],
      reason: 'INVALID_RANDOM_STATE',
    })
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(invalidRng)
  })

  it.each(['payment', 'skill'] as const)(
    'does not overwrite an existing completed %s record',
    (kind) => {
      const { resolving } = setup()
      const conflicting = kind === 'payment'
        ? {
            ...resolving,
            completedResourcePayment: {
              resourceTransactionId: 'resource:existing' as ResourceTransactionId,
              skillExecutionId,
              actionId,
              personalTurnId: resolving.personalTurn?.personalTurnId
                ?? payment(resolving).personalTurnId,
              sequenceId: payment(resolving).sequenceId,
              payerUnitId: unitId('actor'),
            },
          }
        : {
            ...resolving,
            completedSkillResolution: {
              skillExecutionId,
              actionId,
              personalTurnId: payment(resolving).personalTurnId,
              sequenceId: payment(resolving).sequenceId,
            },
          }
      const result = resolveResourcePaidSkillTransaction(
        conflicting,
        payment(conflicting),
        skill(conflicting),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('RESOURCE_PAYMENT_ALREADY_COMPLETED')
        expect(result.state).toBe(conflicting)
      }
      expect(result.events).toEqual([])
      expect(result.state.completedResourcePayment)
        .toBe(conflicting.completedResourcePayment)
      expect(result.state.completedSkillResolution)
        .toBe(conflicting.completedSkillResolution)
    },
  )

  it('rolls a lethal first attack and resource payment back when a later attack fails', () => {
    const initial = setup()
    const withFragileTarget = (state: BattleState): BattleState => ({
      ...state,
      units: state.units.map((unit) => unit.id === unitId('target')
        ? { ...unit, currentHealth: 5 }
        : unit),
    })
    const rng = createFixedSequenceRandomState([])
    const awaiting = { ...withFragileTarget(initial.awaiting), rngState: rng }
    const resolvingBase = withFragileTarget(initial.resolving)
    const resolving = {
      ...resolvingBase,
      rngState: rng,
      actionRollbackState: awaiting,
    }
    const first = skill(resolving).attacks[0]
    if (first.damageType !== DamageType.Normal) return
    const result = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      {
        ...skill(resolving),
        attacks: [
          first,
          {
            ...first,
            attackId: 'attack:after-death' as AttackId,
            criticalRate: 0.5,
            targets: [{
              targetId: unitId('target'),
              damageEventId: 'damage:after-death' as DamageEventId,
            }],
          },
        ],
      },
    )

    expect(result.ok).toBe(false)
    expect(result.state).toBe(awaiting)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ alive: true, currentHealth: 5 })
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 5, momentum: 8 })
    expect(result.events).toEqual([])
    expect(result.state.events.some((event) => event.type === 'UNIT_DIED')).toBe(false)
  })

  it('completes the action only after payment and skill both succeed', () => {
    const { resolving } = setup()
    const resolved = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving),
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, actionId)

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.activeAction).toBeNull()
    expect(completed.state.completedResourcePayment).toBeNull()
    expect(completed.state.actionRollbackState).toBeNull()
  })

  it('rejects reusing a payment transaction in a later skill action', () => {
    const { resolving } = setup()
    const first = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, [], 'resource:reused'),
      skill(resolving),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const completed = completeBattleAction(first.state, actionId)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    const secondActionId = 'action:second-resource' as ActionId
    const secondExecution = 'skill-execution:second' as SkillExecutionId
    const second = startBattleAction(completed.state, {
      actionId: secondActionId,
      actorId: unitId('actor'),
      skillExecutionId: secondExecution,
      endsTurn: false,
    })
    expect(second.ok).toBe(true)
    if (!second.ok || second.state.personalTurn === null
      || second.state.activeAction === null) return
    const secondPayment = {
      resourceTransactionId: 'resource:reused' as ResourceTransactionId,
      actionId: secondActionId,
      personalTurnId: second.state.personalTurn.personalTurnId,
      sequenceId: second.state.activeAction.sequenceId,
      skillExecutionId: secondExecution,
      payerUnitId: unitId('actor'),
      costs: [],
    }
    const secondSkill = {
      ...skill(second.state),
      actionId: secondActionId,
      skillExecutionId: secondExecution,
    }
    const repeated = resolveResourcePaidSkillTransaction(
      second.state,
      secondPayment,
      secondSkill,
    )

    expect(repeated.ok).toBe(false)
    if (!repeated.ok) {
      expect(repeated.reason).toBe('RESOURCE_TRANSACTION_ID_ALREADY_USED')
    }
  })

  it('rejects paying the same completed skill again with a new transaction ID', () => {
    const { resolving } = setup()
    const first = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving, undefined, 'resource:first'),
      skill(resolving),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const repeated = resolveResourcePaidSkillTransaction(
      first.state,
      payment(first.state, undefined, 'resource:second'),
      skill(first.state),
    )

    expect(repeated.ok).toBe(false)
    if (!repeated.ok) {
      expect(repeated.reason).toBe('RESOURCE_PAYMENT_ALREADY_COMPLETED')
      expect(repeated.state).toBe(first.state)
    }
    expect(repeated.events).toEqual([])
    expect(repeated.state.units).toBe(first.state.units)
    expect(repeated.state.events).toBe(first.state.events)
    expect(repeated.state.rngState).toBe(first.state.rngState)
    expect(repeated.state.completedResourcePayment)
      .toBe(first.state.completedResourcePayment)
    expect(repeated.state.completedSkillResolution)
      .toBe(first.state.completedSkillResolution)
    expect(repeated.state.resourcePaymentRegistry)
      .toBe(first.state.resourcePaymentRegistry)
    expect(repeated.state.resolutionIds).toBe(first.state.resolutionIds)
    expect(repeated.state.activeAction).toBe(first.state.activeAction)
    expect(repeated.state.activeSkill).toBe(first.state.activeSkill)
    expect(repeated.state.personalTurn).toBe(first.state.personalTurn)
    expect(repeated.state.personalTurn?.countedActionCount).toBe(0)
    expect(repeated.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ energy: 3, momentum: 5 })
    expect(repeated.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 90, shield: 0 })
  })

  it('records one complete successful action event sequence without zero-value facts', () => {
    const { awaiting, resolving } = setup()
    const resolved = resolveResourcePaidSkillTransaction(
      resolving,
      payment(resolving),
      skill(resolving),
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, actionId)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    expect(completed.state.events.slice(awaiting.events.length).map((event) => {
      if (event.type === 'ACTION_STAGE_REACHED') {
        return `${event.type}:${event.stage}`
      }
      if (event.type === 'RESOURCE_SPENT') {
        return `${event.type}:${event.resourceType}`
      }
      return event.type
    })).toEqual([
      'ACTION_CONFIRMED',
      'ACTION_STARTED',
      'ACTION_STAGE_REACHED:onAction',
      'ACTION_STAGE_REACHED:resourceValidationAndPayment',
      'RESOURCE_SPENT:energy',
      'RESOURCE_SPENT:momentum',
      'ACTION_STAGE_REACHED:skillResolution',
      'SKILL_RESOLUTION_STARTED',
      'ATTACK_STARTED',
      'CRITICAL_ROLLED',
      'DAMAGE_CALCULATED',
      'HEALTH_LOST',
      'ATTACK_COMPLETED',
      'SKILL_RESOLUTION_COMPLETED',
      'ACTION_STAGE_REACHED:afterAction',
      'ACTION_COMPLETED',
    ])
    expect(completed.state.events.filter((event) => (
      (event.type === 'RESOURCE_SPENT' || event.type === 'RESOURCE_GAINED')
      && event.amount === 0
    ))).toEqual([])
  })
})
