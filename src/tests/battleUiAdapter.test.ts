import { describe, expect, it } from 'vitest'
import {
  endUiPlayerTurn,
  endUiTrainingBattleAsDefeat,
  executeUiBattleAction,
  formatBattleEvent,
  getUiBattleEvents,
  getUiHealthText,
  getUiUnitDetails,
  getUiUnitStatusDetails,
  getUiTrainingPauseReason,
  getUnitName,
  getUiBattleActions,
  getUiPlayerFormationSlots,
  getUiShieldShellProgress,
  getUiTrainingStatistics,
  isUiTrainingResultReady,
  pauseUiTrainingBattle,
  requestUiTrainingExit,
  resetUiTrainingBattle,
  resumeUiTrainingBattle,
  startUiTrainingBattle,
  UI_CHARACTER_DEFINITIONS,
} from '../game/ui/battleUiAdapter'
import {
  LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
  LI_MUTOU_UNIT_ID,
} from '../game/content/characters/liMutou'
import {
  TRAINING_DUMMY_UNIT_ID,
} from '../game/content/bosses/trainingDummy'
import {
  YAN_YAN_UNIT_ID,
} from '../game/content/characters/yanYan'
import {
  WANG_DAHAI_THIRD_SKILL_ID,
  WANG_DAHAI_TIDE_COUNTER_ID,
  WANG_DAHAI_UNIT_ID,
} from '../game/content/characters/wangDahai'
import { Position } from '../game/core/enums'
import { TrainingExitConfirmation } from '../game/core/commands'
import type { BattleState } from '../game/core/contexts'

describe('battle UI adapter training setup', () => {
  it('initializes the selected party positions and boss in a training battle', () => {
    const result = startUiTrainingBattle({
      characterKeys: ['liMutou', 'yanYan'],
      positions: {
        liMutou: Position.Back2,
        yanYan: Position.Front1,
      },
      bossKey: 'trainingDummy',
    }, 123)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.trainingSession).not.toBeNull()
    expect(result.state.units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: LI_MUTOU_UNIT_ID,
        position: Position.Back2,
        deploymentOrder: 0,
      }),
      expect.objectContaining({
        id: YAN_YAN_UNIT_ID,
        position: Position.Front1,
        deploymentOrder: 1,
      }),
      expect.objectContaining({
        id: TRAINING_DUMMY_UNIT_ID,
        isBoss: true,
      }),
    ]))
  })

  it('rejects duplicate positions before starting the battle engine', () => {
    const result = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        yanYan: Position.Front1,
      },
      bossKey: 'trainingDummy',
    }, 123)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('每个站位只能配置一名角色')
    expect(result.state.units).toEqual([])
  })

  it('exposes only the current player unit actions and routes them to its existing skill', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liMutou'],
      positions: { liMutou: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)

    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actions = getUiBattleActions(started.state)
    expect(actions.map((action) => action.id)).toEqual([
      'liMutou.spring',
      'liMutou.autumn',
      'liMutou.bladeDomain',
      'liMutou.fallenLeaves',
    ])
    expect(actions[0]).toMatchObject({
      label: '一叶春',
      resourceCost: '无消耗',
      targetRule: '选择 1 名存活敌方',
      description: '造成单体伤害，获得能量、势与春华。',
      effectDetails: [
        '资源：获得 2 点能量、3 点势',
        '伤害：攻击×0.8；命中 1 段',
        '状态：添加 1 层春华，持续至被消耗',
      ],
    })
    const resolved = executeUiBattleAction(
      started.state,
      'liMutou.spring',
      1,
    )

    expect(resolved.ok).toBe(true)
    expect(resolved.state.events).toContainEqual(expect.objectContaining({
      type: 'SKILL_RESOLUTION_STARTED',
      casterId: LI_MUTOU_UNIT_ID,
    }))
  })

  it('provides skill detail values that match the implemented action rules', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(getUiBattleActions(started.state)).toContainEqual(expect.objectContaining({
      id: 'wangDahai.newTide',
      effectDetails: expect.arrayContaining([
        '资源：获得 2 点能量、1 点势',
        '伤害：攻击×1；命中 1 段',
      ]),
    }))
  })

  it('maps every selected player position to its fixed battlefield slot', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Back2,
        liMutou: Position.Front2,
        yanYan: Position.Front1,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(getUiPlayerFormationSlots(started.state.units).map((unit) => unit?.id ?? null)).toEqual([
      YAN_YAN_UNIT_ID,
      LI_MUTOU_UNIT_ID,
      null,
      WANG_DAHAI_UNIT_ID,
    ])
  })

  it('derives health text and the finite-unit shield shell from current state only', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['yanYan'],
      positions: { yanYan: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const yanYan = started.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID)
    const dummy = started.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID)
    expect(yanYan).toBeDefined()
    expect(dummy).toBeDefined()
    if (yanYan === undefined || dummy === undefined) return

    expect(getUiHealthText(yanYan)).toBe('180/180')
    expect(getUiShieldShellProgress(yanYan)).toBeNull()
    expect(getUiShieldShellProgress({ ...yanYan, shield: 180 })).toBe(0.5)
    expect(getUiShieldShellProgress({ ...yanYan, shield: 360 })).toBe(1)
    expect(getUiShieldShellProgress({ ...dummy, shield: 20 })).toBeNull()
  })

  it('reads live effective values, temporary effects, and character-only details from battle state', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        liMutou: Position.Back1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const before = getUiUnitDetails(started.state, WANG_DAHAI_UNIT_ID)
    expect(before?.commonFields).toEqual(expect.arrayContaining([
      { label: '暴击率', value: '0%' },
      { label: '暴击伤害', value: '50%' },
    ]))
    expect(before?.statusDetails).toEqual([])

    const enhanced: BattleState = {
      ...started.state,
      units: started.state.units.map((unit) => {
        if (unit.id === WANG_DAHAI_UNIT_ID) return {
          ...unit,
          normalDamageIncrease: 0.1,
          normalDamageIncreaseSources: [{ sourceId: 'test:increase', modifier: 0.15 }],
          normalDamageReductionSources: [{ sourceId: WANG_DAHAI_THIRD_SKILL_ID, reduction: 0.2 }],
          specialCounters: [{ counterId: WANG_DAHAI_TIDE_COUNTER_ID, value: 2 }],
          temporaryAttributeModifiers: [
            {
              attribute: 'criticalRate', value: 0.2, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 2 },
            },
            {
              attribute: 'criticalDamage', value: 0.5, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 2 },
            },
          ],
        }
        if (unit.id === LI_MUTOU_UNIT_ID) return {
          ...unit,
          specialCounters: [{ counterId: LI_MUTOU_BLADE_DOMAIN_COUNTER_ID, value: 1 }],
        }
        return unit
      }),
    }

    const wang = getUiUnitDetails(enhanced, WANG_DAHAI_UNIT_ID)
    expect(wang?.commonFields).toEqual(expect.arrayContaining([
      { label: '增伤', value: '25%' },
      { label: '减伤', value: '20%' },
      { label: '暴击率', value: '20%' },
      { label: '暴击伤害', value: '100%' },
    ]))
    expect(wang?.exclusiveFields).toEqual([{ label: '海潮', value: 2 }])
    expect(wang?.statusDetails).toEqual(expect.arrayContaining([
      '暴击率+20%（1层），持续2回合',
      '暴击伤害+50%（1层），持续2回合',
    ]))

    expect(getUiUnitDetails(enhanced, LI_MUTOU_UNIT_ID)?.exclusiveFields).toEqual([
      { label: '刀域', value: '开启（1 层）' },
    ])
    expect(getUiUnitDetails(enhanced, YAN_YAN_UNIT_ID)?.exclusiveFields).toEqual([])
    expect(getUiUnitDetails(enhanced, LI_MUTOU_UNIT_ID)?.exclusiveFields).not.toContainEqual(
      expect.objectContaining({ label: '海潮' }),
    )
  })

  it('reads live back-row protection and merges only matching temporary-effect durations', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou'],
      positions: { wangDahai: Position.Front1, liMutou: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(getUiUnitDetails(started.state, LI_MUTOU_UNIT_ID)?.commonFields).toContainEqual(
      { label: '减伤', value: '50%' },
    )
    const unprotected: BattleState = {
      ...started.state,
      units: started.state.units.map((unit) => (
        unit.id === WANG_DAHAI_UNIT_ID
          ? { ...unit, alive: false, currentHealth: 0 }
          : unit
      )),
    }
    expect(getUiUnitDetails(unprotected, LI_MUTOU_UNIT_ID)?.commonFields).toContainEqual(
      { label: '减伤', value: '0%' },
    )

    const effects: BattleState = {
      ...started.state,
      units: started.state.units.map((unit) => (
        unit.id !== WANG_DAHAI_UNIT_ID ? unit : {
          ...unit,
          temporaryAttributeModifiers: [
            {
              attribute: 'attack', value: 2, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 1 },
            },
            {
              attribute: 'attack', value: 2, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 1 },
            },
            {
              attribute: 'criticalRate', value: 0.2, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 2 },
            },
            {
              attribute: 'criticalRate', value: 0.1, sourceId: WANG_DAHAI_THIRD_SKILL_ID,
              duration: { kind: 'ownerTurns', remainingTurns: 1 },
            },
          ],
        }
      )),
    }
    expect(getUiUnitStatusDetails(effects, WANG_DAHAI_UNIT_ID)).toEqual([
      '攻击力+4（2层），持续1回合',
      '暴击率+20%（1层），持续2回合',
      '暴击率+10%（1层），持续1回合',
    ])
  })

  it('filters technical events and formats actual action and trigger results', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou'],
      positions: { wangDahai: Position.Front1, liMutou: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const state: BattleState = {
      ...started.state,
      events: [
        { type: 'SEQUENCE_STARTED', sequenceId: 'sequence:1', sequenceNumber: 1, orderedUnitIds: [] },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'boss-skill', actionId: 'boss-action',
          skillId: 'skill:training-dummy:revenge', casterId: TRAINING_DUMMY_UNIT_ID,
          sourceUnitId: TRAINING_DUMMY_UNIT_ID, resolutionKind: 'automatic',
        },
        {
          type: 'DAMAGE_CALCULATED',
          damage: {
            skillExecutionId: 'boss-skill', sourceUnitId: TRAINING_DUMMY_UNIT_ID,
            targetUnitId: WANG_DAHAI_UNIT_ID, resolvedValue: 5, critical: true,
          },
        },
        { type: 'SKILL_RESOLUTION_COMPLETED', skillExecutionId: 'boss-skill', actionId: 'boss-action', skillId: 'skill:training-dummy:revenge', casterId: TRAINING_DUMMY_UNIT_ID },
        {
          type: 'SHIELD_GAINED', unitId: TRAINING_DUMMY_UNIT_ID, amount: 20,
          reason: 'trainingDummySteadfast', sourceUnitId: TRAINING_DUMMY_UNIT_ID,
          effectId: 'trainingDummySteadfast', skillExecutionId: null,
        },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'li-skill', actionId: 'li-action',
          skillId: 'skill:li-mutou:first', casterId: LI_MUTOU_UNIT_ID,
          sourceUnitId: LI_MUTOU_UNIT_ID, resolutionKind: 'manual',
          context: { branchId: 'skill-branch:li-mutou:spring' },
        },
        {
          type: 'STATUS_ACQUIRED', ownerUnitId: LI_MUTOU_UNIT_ID,
          statusId: 'status:li-mutou:spring-blossom', stacks: 1, remainingOwnerTurns: 2,
          sourceUnitId: LI_MUTOU_UNIT_ID, skillExecutionId: 'li-skill',
          effectId: 'skill:li-mutou:first',
        },
      ] as unknown as BattleState['events'],
    }

    expect(getUiBattleEvents(state)).toEqual([
      { kind: 'trigger', text: '训练假人的报复被触发，目标：王大海。造成了5点伤害！（暴击）' },
      { kind: 'trigger', text: '训练假人的坚守被触发。获得了20点护盾。' },
      { kind: 'action', text: '李木头释放了一叶春。获得了1层春华，持续2个自身回合。' },
    ])
  })

  it('uses explicit event origins for passives, automatic skills, group effects, and missing context', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        liMutou: Position.Back1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const state: BattleState = {
      ...started.state,
      events: [
        {
          type: 'RESOURCE_GAINED', unitId: WANG_DAHAI_UNIT_ID, resourceType: 'energy',
          amount: 2, sourceUnitId: WANG_DAHAI_UNIT_ID, effectId: 'wangDahaiTidalBladeMomentum',
          skillExecutionId: null,
        },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'myriad', actionId: 'action',
          skillId: 'skill:wang-dahai:myriad-rivers', casterId: WANG_DAHAI_UNIT_ID,
          sourceUnitId: WANG_DAHAI_UNIT_ID, resolutionKind: 'automatic',
          context: { targetIds: [TRAINING_DUMMY_UNIT_ID] },
        },
        {
          type: 'ATTACK_STARTED', context: {
            attackId: 'myriad-attack', skillExecutionId: 'myriad',
            attackerId: WANG_DAHAI_UNIT_ID, attackIndex: 0, damageType: 'normal',
            targetIds: [TRAINING_DUMMY_UNIT_ID], targets: [], protectionSnapshot: [],
            momentumPressureSnapshot: 0,
          },
        },
        {
          type: 'DAMAGE_CALCULATED', damage: {
            skillExecutionId: 'myriad', attackId: 'myriad-attack',
            sourceUnitId: WANG_DAHAI_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID,
            resolvedValue: 20, critical: false,
          },
        },
        {
          type: 'SHIELD_GAINED', unitId: WANG_DAHAI_UNIT_ID, amount: 8,
          sourceUnitId: YAN_YAN_UNIT_ID, effectId: 'yanYanImmovableMountainAllyShield',
          skillExecutionId: null,
        },
        {
          type: 'SHIELD_GAINED', unitId: LI_MUTOU_UNIT_ID, amount: 8,
          sourceUnitId: YAN_YAN_UNIT_ID, effectId: 'yanYanImmovableMountainAllyShield',
          skillExecutionId: null,
        },
        {
          type: 'HEALTH_RESTORED', unitId: LI_MUTOU_UNIT_ID, amount: 5,
          sourceUnitId: LI_MUTOU_UNIT_ID, effectId: 'status:li-mutou:spring-blossom',
          skillExecutionId: null,
        },
        {
          type: 'MOMENTUM_PRESSURE_TRIGGERED',
          skillExecutionId: 'pressure-skill', attackId: 'pressure-attack',
          damageEventId: 'pressure-damage', sourceUnitId: YAN_YAN_UNIT_ID,
          targetUnitId: TRAINING_DUMMY_UNIT_ID, momentumPressure: 3, extraDamage: 3,
        },
        {
          type: 'EXTRA_DAMAGE_APPLIED', damage: {
            sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID,
            eventId: 'pressure-damage', resolvedValue: 3, extraDamageSource: 'momentumPressure',
          },
        },
        {
          type: 'SHIELD_GAINED', unitId: WANG_DAHAI_UNIT_ID, amount: 99,
          sourceUnitId: null, effectId: null, skillExecutionId: null,
        },
      ] as unknown as BattleState['events'],
    }

    expect(getUiBattleEvents(state).map((event) => event.text)).toEqual(expect.arrayContaining([
      '王大海的海潮刀势被触发。获得了2点能量。',
      '王大海的万江归海被触发，目标：训练假人。造成了20点伤害！（第1段伤害）',
      '严岩的不动如山被触发。为王大海获得了8点护盾、为李木头获得了8点护盾。',
      '李木头的春华被触发。恢复了5点生命值。',
      '严岩的势压被触发，目标：训练假人。造成了3点伤害！',
    ]))
    expect(getUiBattleEvents(state).map((event) => event.text).join('\n')).not.toContain('海刃')
    expect(getUiBattleEvents(state).map((event) => event.text).join('\n')).not.toContain('王大海的不动如山')
    expect(getUiBattleEvents(state).map((event) => event.text).join('\n')).not.toContain('99点护盾')
  })

  it('filters lifecycle events while retaining action-linked 起势 and one settled record per 势压 hit', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        liMutou: Position.Back1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const text = getUiBattleEvents({
      ...started.state,
      events: [
        {
          type: 'SPECIAL_COUNTER_CHANGED', unitId: WANG_DAHAI_UNIT_ID,
          counterId: WANG_DAHAI_TIDE_COUNTER_ID, operation: 'decrease', amount: 1,
          before: 2, after: 1, sourceUnitId: WANG_DAHAI_UNIT_ID,
          effectId: WANG_DAHAI_THIRD_SKILL_ID, actionId: null,
          personalTurnId: 'turn:wang:end', sequenceId: 'sequence:1', skillExecutionId: null,
        },
        {
          type: 'RESOURCE_GAINED', unitId: WANG_DAHAI_UNIT_ID, resourceType: 'momentum',
          amount: 1, reason: 'wangDahaiRisingMomentum', sourceUnitId: WANG_DAHAI_UNIT_ID,
          effectId: 'wangDahaiRisingMomentum', actionId: null,
          personalTurnId: 'turn:wang:end', sequenceId: 'sequence:1', skillExecutionId: null,
        },
        { type: 'TEMPORARY_ATTRIBUTE_CHANGED', operation: 'durationDecremented', unitId: WANG_DAHAI_UNIT_ID, attribute: 'attack', sourceUnitId: WANG_DAHAI_UNIT_ID, effectId: WANG_DAHAI_UNIT_ID, value: 2, durationKind: 'currentPersonalTurn', remainingOwnerTurns: null, expiresAtPersonalTurnId: 'turn:wang:end', actionId: null, personalTurnId: 'turn:wang:end', sequenceId: 'sequence:1', skillExecutionId: null },
        { type: 'TEMPORARY_ATTRIBUTE_CHANGED', operation: 'removed', unitId: WANG_DAHAI_UNIT_ID, attribute: 'attack', sourceUnitId: WANG_DAHAI_UNIT_ID, effectId: WANG_DAHAI_UNIT_ID, value: 2, durationKind: 'currentPersonalTurn', remainingOwnerTurns: null, expiresAtPersonalTurnId: 'turn:wang:end', actionId: null, personalTurnId: 'turn:wang:end', sequenceId: 'sequence:1', skillExecutionId: null },
        { type: 'STATUS_DURATION_DECREMENTED', ownerUnitId: LI_MUTOU_UNIT_ID, statusId: 'status:li-mutou:spring-blossom', category: 'buff', batchId: 'batch:spring', previousBatchId: null, stacks: 1, remainingOwnerTurns: 1, sourceUnitId: LI_MUTOU_UNIT_ID, effectId: 'status:li-mutou:spring-blossom', skillExecutionId: null },
        { type: 'STATUS_REMOVED', ownerUnitId: LI_MUTOU_UNIT_ID, statusId: 'status:li-mutou:spring-blossom', category: 'buff', batchId: 'batch:spring', previousBatchId: null, stacks: 0, remainingOwnerTurns: 0, sourceUnitId: LI_MUTOU_UNIT_ID, effectId: 'status:li-mutou:spring-blossom', skillExecutionId: null },
        { type: 'RESOURCE_SET', unitId: LI_MUTOU_UNIT_ID, resourceType: 'momentum', before: 3, after: 0, reason: 'internalReset', sourceId: null, sourceUnitId: LI_MUTOU_UNIT_ID, effectId: 'liMutouMicroMomentum', actionId: null, personalTurnId: 'turn:li:end', sequenceId: 'sequence:1', skillExecutionId: null, resourceTransactionId: null },
        { type: 'ACTION_STARTED', actionId: 'action:wang', unitId: WANG_DAHAI_UNIT_ID },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'skill:wang', actionId: 'action:wang',
          skillId: 'skill:wang-dahai:first', casterId: WANG_DAHAI_UNIT_ID,
          sourceUnitId: WANG_DAHAI_UNIT_ID, resolutionKind: 'manual',
          context: { targetIds: [TRAINING_DUMMY_UNIT_ID] },
        },
        {
          type: 'RESOURCE_GAINED', unitId: WANG_DAHAI_UNIT_ID, resourceType: 'momentum',
          amount: 1, reason: 'wangDahaiRisingMomentum', sourceUnitId: WANG_DAHAI_UNIT_ID,
          effectId: 'wangDahaiRisingMomentum', actionId: 'action:wang',
          personalTurnId: 'turn:wang:action', sequenceId: 'sequence:1', skillExecutionId: 'skill:wang',
        },
        { type: 'ACTION_COMPLETED', actionId: 'action:wang', unitId: WANG_DAHAI_UNIT_ID },
        {
          type: 'MOMENTUM_PRESSURE_TRIGGERED', skillExecutionId: 'pressure:skill', attackId: 'pressure:attack',
          damageEventId: 'pressure:one', sourceUnitId: YAN_YAN_UNIT_ID,
          targetUnitId: TRAINING_DUMMY_UNIT_ID, momentumPressure: 2, extraDamage: 2,
        },
        { type: 'EXTRA_DAMAGE_APPLIED', damage: { eventId: 'pressure:one', skillExecutionId: 'pressure:skill', attackId: 'pressure:attack', sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 2, extraDamageSource: 'momentumPressure' } },
        {
          type: 'MOMENTUM_PRESSURE_TRIGGERED', skillExecutionId: 'pressure:skill', attackId: 'pressure:attack',
          damageEventId: 'pressure:two', sourceUnitId: YAN_YAN_UNIT_ID,
          targetUnitId: WANG_DAHAI_UNIT_ID, momentumPressure: 2, extraDamage: 2,
        },
        { type: 'EXTRA_DAMAGE_APPLIED', damage: { eventId: 'pressure:two', skillExecutionId: 'pressure:skill', attackId: 'pressure:attack', sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: WANG_DAHAI_UNIT_ID, resolvedValue: 2, extraDamageSource: 'momentumPressure' } },
        {
          type: 'MOMENTUM_PRESSURE_TRIGGERED', skillExecutionId: 'pressure:empty', attackId: 'pressure:attack',
          damageEventId: 'pressure:empty', sourceUnitId: YAN_YAN_UNIT_ID,
          targetUnitId: LI_MUTOU_UNIT_ID, momentumPressure: 2, extraDamage: 2,
        },
      ] as unknown as BattleState['events'],
    }).map((event) => event.text)

    expect(text.join('\n')).not.toContain('月海潮生被触发')
    expect(text.join('\n')).not.toContain('起势被触发')
    expect(text).toContain('王大海释放了新潮式，目标：训练假人。起势：获得了1点势。')
    expect(text.filter((entry) => entry.includes('势压被触发'))).toEqual([
      '严岩的势压被触发，目标：训练假人。造成了2点伤害！',
      '严岩的势压被触发，目标：王大海。造成了2点伤害！',
    ])
  })

  it('merges a new tide action into one ordered record without self-target wording', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const state: BattleState = {
      ...started.state,
      events: [
        { type: 'ACTION_STARTED', actionId: 'wang-action' },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'wang-skill', actionId: 'wang-action',
          skillId: 'skill:wang-dahai:first', casterId: WANG_DAHAI_UNIT_ID,
          sourceUnitId: WANG_DAHAI_UNIT_ID, resolutionKind: 'manual',
          context: { branchId: 'skill-branch:wang-dahai:new-tide', targetIds: [TRAINING_DUMMY_UNIT_ID] },
        },
        {
          type: 'RESOURCE_GAINED', unitId: WANG_DAHAI_UNIT_ID, resourceType: 'energy', amount: 2,
          sourceUnitId: WANG_DAHAI_UNIT_ID, effectId: 'skill:wang-dahai:first', skillExecutionId: 'wang-skill',
        },
        {
          type: 'RESOURCE_GAINED', unitId: WANG_DAHAI_UNIT_ID, resourceType: 'momentum', amount: 1,
          sourceUnitId: WANG_DAHAI_UNIT_ID, effectId: 'skill:wang-dahai:first', skillExecutionId: 'wang-skill',
        },
        {
          type: 'ATTACK_STARTED', context: {
            attackId: 'wang-attack', skillExecutionId: 'wang-skill', attackerId: WANG_DAHAI_UNIT_ID,
            attackIndex: 0, damageType: 'normal', targetIds: [TRAINING_DUMMY_UNIT_ID], targets: [],
            protectionSnapshot: [], momentumPressureSnapshot: 0,
          },
        },
        {
          type: 'DAMAGE_CALCULATED', damage: {
            skillExecutionId: 'wang-skill', attackId: 'wang-attack', sourceUnitId: WANG_DAHAI_UNIT_ID,
            targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 28, critical: true,
          },
        },
        { type: 'ACTION_COMPLETED', actionId: 'wang-action' },
      ] as unknown as BattleState['events'],
    }

    const visible = getUiBattleEvents(state)
    expect(visible).toEqual([{
      kind: 'action',
      text: '王大海释放了新潮式，目标：训练假人。获得了2点能量、获得了1点势、造成了28点伤害！（第1段伤害）（暴击）',
    }])
    expect(visible[0].text).not.toContain('王大海对王大海释放')
  })

  it('keeps multi-target effects, passive triggers, and adjacent boss actions in separate merged records', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        liMutou: Position.Back1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const state: BattleState = {
      ...started.state,
      events: [
        { type: 'ACTION_STARTED', actionId: 'yan-action' },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'yan-skill', actionId: 'yan-action',
          skillId: 'skill:yan-yan:first', casterId: YAN_YAN_UNIT_ID, sourceUnitId: YAN_YAN_UNIT_ID,
          resolutionKind: 'manual', context: { targetIds: [WANG_DAHAI_UNIT_ID, LI_MUTOU_UNIT_ID] },
        },
        { type: 'SHIELD_GAINED', unitId: WANG_DAHAI_UNIT_ID, amount: 8, sourceUnitId: YAN_YAN_UNIT_ID, effectId: 'skill:yan-yan:first', skillExecutionId: 'yan-skill' },
        { type: 'HEALTH_RESTORED', unitId: LI_MUTOU_UNIT_ID, amount: 5, sourceUnitId: YAN_YAN_UNIT_ID, effectId: 'skill:yan-yan:first', skillExecutionId: 'yan-skill' },
        { type: 'STATUS_ACQUIRED', ownerUnitId: LI_MUTOU_UNIT_ID, statusId: 'status:li-mutou:spring-blossom', stacks: 1, remainingOwnerTurns: 2, sourceUnitId: YAN_YAN_UNIT_ID, effectId: 'skill:yan-yan:first', skillExecutionId: 'yan-skill' },
        { type: 'ATTACK_STARTED', context: { attackId: 'yan-first', skillExecutionId: 'yan-skill', attackerId: YAN_YAN_UNIT_ID, attackIndex: 0, damageType: 'normal', targetIds: [TRAINING_DUMMY_UNIT_ID], targets: [], protectionSnapshot: [], momentumPressureSnapshot: 0 } },
        { type: 'DAMAGE_CALCULATED', damage: { skillExecutionId: 'yan-skill', attackId: 'yan-first', sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 11, critical: false } },
        { type: 'ATTACK_STARTED', context: { attackId: 'yan-second', skillExecutionId: 'yan-skill', attackerId: YAN_YAN_UNIT_ID, attackIndex: 1, damageType: 'normal', targetIds: [TRAINING_DUMMY_UNIT_ID], targets: [], protectionSnapshot: [], momentumPressureSnapshot: 0 } },
        { type: 'DAMAGE_CALCULATED', damage: { skillExecutionId: 'yan-skill', attackId: 'yan-second', sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 7, critical: true } },
        { type: 'ACTION_COMPLETED', actionId: 'yan-action' },
        { type: 'RESOURCE_SPENT', unitId: LI_MUTOU_UNIT_ID, resourceType: 'momentum', amount: 2, sourceUnitId: LI_MUTOU_UNIT_ID, effectId: 'liMutouMicroMomentum', skillExecutionId: null },
        { type: 'ACTION_STARTED', actionId: 'boss-action' },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'boss-skill', actionId: 'boss-action',
          skillId: 'skill:training-dummy:revenge', casterId: TRAINING_DUMMY_UNIT_ID,
          sourceUnitId: TRAINING_DUMMY_UNIT_ID, resolutionKind: 'automatic',
          context: { targetIds: [WANG_DAHAI_UNIT_ID] },
        },
        { type: 'ACTION_COMPLETED', actionId: 'boss-action' },
        { type: 'ACTION_STARTED', actionId: 'wang-action' },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'wang-skill', actionId: 'wang-action',
          skillId: 'skill:wang-dahai:first', casterId: WANG_DAHAI_UNIT_ID,
          sourceUnitId: WANG_DAHAI_UNIT_ID, resolutionKind: 'manual',
          context: { branchId: 'skill-branch:wang-dahai:new-tide', targetIds: [TRAINING_DUMMY_UNIT_ID] },
        },
      ] as unknown as BattleState['events'],
    }

    expect(getUiBattleEvents(state)).toEqual([
      {
        kind: 'action',
        text: '严岩释放了镇山岳，目标：王大海、李木头。为王大海获得了8点护盾、为李木头恢复了5点生命值、为李木头获得了1层春华，持续2个自身回合、对训练假人造成了11点伤害！（第1段伤害）、对训练假人造成了7点伤害！（第2段伤害）（暴击）',
      },
      { kind: 'trigger', text: '李木头的微势被触发。消耗了2点势。' },
      { kind: 'trigger', text: '训练假人的报复被触发，目标：王大海。' },
      { kind: 'action', text: '王大海释放了新潮式，目标：训练假人。' },
    ])
  })

  it('reads every current character and boss skill name from the content display registry', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou', 'yanYan'],
      positions: {
        wangDahai: Position.Front1,
        liMutou: Position.Back1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const skillEvents = [
      ['skill:wang-dahai:first', WANG_DAHAI_UNIT_ID],
      ['skill:wang-dahai:moonlit-tide', WANG_DAHAI_UNIT_ID],
      ['skill:yan-yan:first', YAN_YAN_UNIT_ID],
      ['skill:yan-yan:peaks', YAN_YAN_UNIT_ID],
      ['skill:yan-yan:ridges', YAN_YAN_UNIT_ID],
      ['skill:yan-yan:baiyue', YAN_YAN_UNIT_ID],
      ['skill:li-mutou:first', LI_MUTOU_UNIT_ID],
      ['skill:li-mutou:second', LI_MUTOU_UNIT_ID],
      ['skill:li-mutou:third', LI_MUTOU_UNIT_ID],
      ['skill:training-dummy:revenge', TRAINING_DUMMY_UNIT_ID],
    ].map(([skillId, casterId], index) => ({
      type: 'SKILL_RESOLUTION_STARTED' as const,
      skillExecutionId: `name:${index}`,
      actionId: `action:${index}`,
      skillId,
      casterId,
      sourceUnitId: casterId,
      resolutionKind: skillId === 'skill:training-dummy:revenge' ? 'automatic' as const : 'manual' as const,
      context: { targetIds: [TRAINING_DUMMY_UNIT_ID] },
    }))
    const text = getUiBattleEvents({
      ...started.state,
      events: skillEvents as unknown as BattleState['events'],
    }).map((event) => event.text).join('\n')

    for (const name of [
      '新潮式', '月海潮生', '镇山岳', '峰峦起', '层峦叠嶂', '拜岳凿天',
      '一叶春', '刀域·无边木叶', '千山落木，敝叶遮天', '报复',
    ]) expect(text).toContain(name)
    expect(text).not.toContain('未命名技能')
    expect(text).not.toContain('百岳')
  })

  it('uses the same 严岩 display name in selection data and battle unit data', () => {
    const definition = UI_CHARACTER_DEFINITIONS.find((character) => (
      character.key === 'yanYan'
    ))
    expect(definition?.name).toBe('严岩')

    const started = startUiTrainingBattle({
      characterKeys: ['yanYan'],
      positions: { yanYan: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(getUnitName(started.state, YAN_YAN_UNIT_ID)).toBe('严岩')
  })

  it('formats settled event values as player-readable battle events', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou'],
      positions: { wangDahai: Position.Front1, liMutou: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(formatBattleEvent(started.state, {
      type: 'DAMAGE_CALCULATED',
      damage: {
        sourceUnitId: WANG_DAHAI_UNIT_ID,
        targetUnitId: TRAINING_DUMMY_UNIT_ID,
        damageType: 'normal',
        resolvedValue: 12,
      },
    } as unknown as BattleState['events'][number])).toBe('王大海对训练假人造成 12 点伤害')
    expect(formatBattleEvent(started.state, {
      type: 'SKILL_RESOLUTION_STARTED',
      skillId: 'skill:wang-dahai:first',
      casterId: WANG_DAHAI_UNIT_ID,
      context: { branchId: 'skill-branch:wang-dahai:stacking-wave' },
    } as unknown as BattleState['events'][number])).toBe('王大海使用叠浪式')
    expect(formatBattleEvent(started.state, {
      type: 'SHIELD_GAINED',
      unitId: WANG_DAHAI_UNIT_ID,
      amount: 6,
    } as unknown as BattleState['events'][number])).toBe('王大海获得 6 点护盾')
    expect(formatBattleEvent(started.state, {
      type: 'STATUS_ACQUIRED',
      ownerUnitId: LI_MUTOU_UNIT_ID,
      statusId: 'status:li-mutou:spring-blossom',
      stacks: 1,
    } as unknown as BattleState['events'][number])).toBe('李木头获得春华（1 层）')
  })

  it('pauses manually, keeps log formatting read-only, and resets the same training setup', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['yanYan'],
      positions: { yanYan: Position.Front2 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const paused = pauseUiTrainingBattle(started.state)

    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    const eventsBeforeRead = paused.state.events
    expect(formatBattleEvent(paused.state, {
      type: 'TRAINING_PAUSED',
      reason: 'MANUAL_PAUSE',
    })).toBe('玩家手动暂停了训练')
    expect(paused.state.events).toBe(eventsBeforeRead)
    expect(paused.state.phase).toBe('paused')
    const reset = resetUiTrainingBattle(paused.state)

    expect(reset.ok).toBe(true)
    if (!reset.ok) return
    expect(reset.state.phase).not.toBe('paused')
    expect(reset.state.units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: YAN_YAN_UNIT_ID,
        position: Position.Front2,
        deploymentOrder: 0,
      }),
      expect.objectContaining({ id: TRAINING_DUMMY_UNIT_ID }),
    ]))
  })

  it('keeps a paused battle unchanged when training exit is cancelled', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const paused = pauseUiTrainingBattle(started.state)
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    const requested = requestUiTrainingExit(
      paused.state,
      TrainingExitConfirmation.NotProvided,
    )
    const cancelled = requestUiTrainingExit(
      paused.state,
      TrainingExitConfirmation.Cancelled,
    )
    const exited = requestUiTrainingExit(
      paused.state,
      TrainingExitConfirmation.Confirmed,
    )

    expect(requested.status).toBe('confirmationRequired')
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      state: paused.state,
      returnToModeSelection: false,
    })
    expect(exited).toMatchObject({
      status: 'exited',
      returnToModeSelection: true,
      state: expect.objectContaining({ phase: 'finished' }),
    })
  })

  it('reaches the same paused state when all player units are defeated automatically', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    let state = started.state
    for (let index = 0; index < 24 && state.phase !== 'paused'; index += 1) {
      const ended = endUiPlayerTurn(state)
      expect(ended.ok).toBe(true)
      state = ended.state
    }

    expect(state.phase).toBe('paused')
    const pauseEvent = state.events.find((event) => event.type === 'TRAINING_PAUSED')
    expect(pauseEvent).toEqual({
      type: 'TRAINING_PAUSED',
      reason: 'ALL_PLAYER_UNITS_DEFEATED',
    })
    expect(getUiTrainingPauseReason(state)).toBe('ALL_PLAYER_UNITS_DEFEATED')
  })

  it('identifies manual pauses as resumable UI pauses without confusing them with finished battles', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['yanYan'],
      positions: { yanYan: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const paused = pauseUiTrainingBattle(started.state)
    expect(paused.ok).toBe(true)
    if (!paused.ok) return

    expect(getUiTrainingPauseReason(paused.state)).toBe('MANUAL_PAUSE')
    expect(getUiTrainingPauseReason(started.state)).toBeNull()
    expect(getUiTrainingPauseReason({
      ...paused.state,
      phase: 'finished',
    })).toBeNull()

    const resumed = resumeUiTrainingBattle(paused.state, started.state)
    expect(resumed).toEqual({ ok: true, state: started.state })

    const automaticPaused = {
      ...paused.state,
      events: [{ type: 'TRAINING_PAUSED', reason: 'ALL_PLAYER_UNITS_DEFEATED' }],
    } as BattleState
    expect(resumeUiTrainingBattle(automaticPaused, started.state)).toMatchObject({
      ok: false,
      state: automaticPaused,
      reason: 'TRAINING_PAUSE_CANNOT_RESUME',
    })
  })

  it('opens a defeat result view without changing settled training statistics', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const action = executeUiBattleAction(started.state, 'wangDahai.newTide', 1)
    expect(action.ok).toBe(true)

    const result = endUiTrainingBattleAsDefeat(action.state)
    expect(result).toEqual({ outcome: 'defeat', state: action.state })
    expect(result === null ? 0 : getUiTrainingStatistics(result.state).units.find((unit) => (
      unit.unitId === WANG_DAHAI_UNIT_ID
    ))?.totalDamageDealt).toBeGreaterThan(0)
  })

  it('keeps every zero-valued sequence and player statistic for a manual defeat result', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'liMutou'],
      positions: { wangDahai: Position.Front1, liMutou: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const settled: BattleState = {
      ...started.state,
      phase: 'paused',
      events: [
        { type: 'SEQUENCE_STARTED', sequenceId: 'sequence:1', sequenceNumber: 1, orderedUnitIds: [] },
        {
          type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'wang-skill', actionId: 'wang-action',
          skillId: 'skill:wang-dahai:first', casterId: WANG_DAHAI_UNIT_ID,
          sourceUnitId: WANG_DAHAI_UNIT_ID, resolutionKind: 'manual',
        },
        {
          type: 'DAMAGE_CALCULATED', damage: {
            skillExecutionId: 'wang-skill', sourceUnitId: WANG_DAHAI_UNIT_ID,
            targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 6,
          },
        },
        { type: 'SHIELD_GAINED', unitId: WANG_DAHAI_UNIT_ID, amount: 3, skillExecutionId: 'wang-skill' },
        { type: 'HEALTH_RESTORED', unitId: WANG_DAHAI_UNIT_ID, amount: 2, skillExecutionId: 'wang-skill' },
        { type: 'SEQUENCE_STARTED', sequenceId: 'sequence:2', sequenceNumber: 2, orderedUnitIds: [] },
      ] as unknown as BattleState['events'],
    }
    const defeat = endUiTrainingBattleAsDefeat(settled)
    expect(defeat).toEqual({ outcome: 'defeat', state: settled })
    const expectedStatistics = {
      sequenceCount: 2,
      sequences: [
        { sequenceNumber: 1, totalDamage: 6 },
        { sequenceNumber: 2, totalDamage: 0 },
      ],
      units: expect.arrayContaining([
        {
          unitId: WANG_DAHAI_UNIT_ID,
          unitName: '王大海',
          totalDamageDealt: 6,
          totalDamageTaken: 0,
          totalShieldGranted: 3,
          totalHealing: 2,
        },
        {
          unitId: LI_MUTOU_UNIT_ID,
          unitName: '李木头',
          totalDamageDealt: 0,
          totalDamageTaken: 0,
          totalShieldGranted: 0,
          totalHealing: 0,
        },
      ]),
    }
    expect(getUiTrainingStatistics(defeat?.state ?? settled)).toEqual(expectedStatistics)
    const victoryState: BattleState = {
      ...settled,
      phase: 'finished',
      events: [...settled.events, {
        type: 'TRAINING_FINISHED', reason: 'FINITE_HEALTH_BOSS_DEFEATED',
      }] as BattleState['events'],
    }
    expect(getUiTrainingStatistics(victoryState)).toEqual(expectedStatistics)
  })

  it('aggregates sequence and player statistics from settled battle events', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai', 'yanYan'],
      positions: { wangDahai: Position.Front1, yanYan: Position.Back1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const state: BattleState = {
      ...started.state,
      events: [
        { type: 'SEQUENCE_STARTED', sequenceId: 'sequence:1', sequenceNumber: 1, orderedUnitIds: [] },
        { type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'wang-skill', actionId: 'wang-action', skillId: 'wang-skill-id', casterId: WANG_DAHAI_UNIT_ID },
        { type: 'DAMAGE_CALCULATED', damage: { sourceUnitId: WANG_DAHAI_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 10 } },
        { type: 'SKILL_RESOLUTION_STARTED', skillExecutionId: 'yan-skill', actionId: 'yan-action', skillId: 'yan-skill-id', casterId: YAN_YAN_UNIT_ID },
        { type: 'EXTRA_DAMAGE_APPLIED', damage: { sourceUnitId: YAN_YAN_UNIT_ID, targetUnitId: TRAINING_DUMMY_UNIT_ID, resolvedValue: 3 } },
        { type: 'SHIELD_GAINED', unitId: WANG_DAHAI_UNIT_ID, amount: 6, skillExecutionId: 'yan-skill' },
        { type: 'HEALTH_RESTORED', unitId: YAN_YAN_UNIT_ID, amount: 4, skillExecutionId: 'yan-skill' },
        { type: 'SEQUENCE_STARTED', sequenceId: 'sequence:2', sequenceNumber: 2, orderedUnitIds: [] },
        { type: 'DAMAGE_CALCULATED', damage: { sourceUnitId: TRAINING_DUMMY_UNIT_ID, targetUnitId: WANG_DAHAI_UNIT_ID, resolvedValue: 5 } },
      ] as unknown as BattleState['events'],
    }

    expect(getUiTrainingStatistics(state)).toEqual({
      sequenceCount: 2,
      sequences: [
        { sequenceNumber: 1, totalDamage: 13 },
        { sequenceNumber: 2, totalDamage: 5 },
      ],
      units: expect.arrayContaining([
        expect.objectContaining({
          unitId: WANG_DAHAI_UNIT_ID,
          totalDamageDealt: 10,
          totalDamageTaken: 5,
          totalShieldGranted: 0,
          totalHealing: 0,
        }),
        expect.objectContaining({
          unitId: YAN_YAN_UNIT_ID,
          totalDamageDealt: 3,
          totalDamageTaken: 0,
          totalShieldGranted: 6,
          totalHealing: 4,
        }),
      ]),
    })
  })

  it('recognizes only the finite-boss finished event as a result-page outcome', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const finiteBossFinished: BattleState = {
      ...started.state,
      phase: 'finished',
      events: [{
        type: 'TRAINING_FINISHED',
        reason: 'FINITE_HEALTH_BOSS_DEFEATED',
      }],
    }
    const infiniteBossFinished: BattleState = {
      ...started.state,
      phase: 'finished',
      events: [{ type: 'TRAINING_EXIT_CONFIRMED' }],
    }

    expect(isUiTrainingResultReady(finiteBossFinished)).toBe(true)
    expect(isUiTrainingResultReady(infiniteBossFinished)).toBe(false)
  })

  it('clears accumulated statistics when the same training battle is restarted', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['wangDahai'],
      positions: { wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 123)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const action = executeUiBattleAction(
      started.state,
      'wangDahai.newTide',
      1,
    )
    expect(action.ok).toBe(true)
    if (!action.ok) return
    expect(getUiTrainingStatistics(action.state).units.find((unit) => (
      unit.unitId === WANG_DAHAI_UNIT_ID
    ))?.totalDamageDealt).toBeGreaterThan(0)
    const reset = resetUiTrainingBattle(action.state)

    expect(reset.ok).toBe(true)
    if (!reset.ok) return
    expect(getUiTrainingStatistics(reset.state).units).toContainEqual(
      expect.objectContaining({
        unitId: WANG_DAHAI_UNIT_ID,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalShieldGranted: 0,
        totalHealing: 0,
      }),
    )
  })
})
