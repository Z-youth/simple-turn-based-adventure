import { GAME_CONTENT_BATTLE_EXTENSIONS } from '../content/battleExtensions'
import {
  displayCounterName,
  displayEffectName,
  displaySkillName,
  displayStatusName,
} from './contentDisplay'
import { groupUiBattleEventsByAction } from './battleUiFeedback'
import {
  createTrainingDummy,
  TRAINING_DUMMY_UNIT_ID,
} from '../content/bosses/trainingDummy'
import {
  createLiMutou,
  LI_MUTOU_UNIT_ID,
  LI_MUTOU_AUTUMN_BRANCH_ID,
  LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
  LI_MUTOU_FIRST_SKILL_ID,
  LI_MUTOU_SECOND_SKILL_ID,
  LI_MUTOU_SPRING_BRANCH_ID,
  LI_MUTOU_THIRD_SKILL_ID,
  useLiMutouFirstSkill as resolveLiMutouFirstSkill,
  useLiMutouSecondSkill as resolveLiMutouSecondSkill,
  useLiMutouThirdSkill as resolveLiMutouThirdSkill,
} from '../content/characters/liMutou'
import {
  createWangDahai,
  isWangDahaiActiveSkillAllowed,
  MOONLIT_TIDE_ENERGY_COST,
  STACKING_WAVE_ENERGY_COST,
  useWangDahaiFirstSkill as resolveWangDahaiFirstSkill,
  useWangDahaiThirdSkill as resolveWangDahaiThirdSkill,
  WANG_DAHAI_FIRST_SKILL_ID,
  WANG_DAHAI_NEW_TIDE_BRANCH_ID,
  WANG_DAHAI_STACKING_WAVE_BRANCH_ID,
  WANG_DAHAI_THIRD_SKILL_ID,
  WANG_DAHAI_TIDE_COUNTER_ID,
  WANG_DAHAI_UNIT_ID,
} from '../content/characters/wangDahai'
import {
  createYanYan,
  useYanYanBaiyueSkill as resolveYanYanBaiyueSkill,
  useYanYanFirstSkill as resolveYanYanFirstSkill,
  useYanYanPeaksSkill as resolveYanYanPeaksSkill,
  useYanYanRidgesSkill as resolveYanYanRidgesSkill,
  YAN_YAN_BAIYUE_SKILL_ID,
  YAN_YAN_FIRST_SKILL_ID,
  YAN_YAN_PEAKS_SKILL_ID,
  YAN_YAN_RIDGES_SKILL_ID,
  YAN_YAN_UNIT_ID,
} from '../content/characters/yanYan'
import {
  pauseTrainingBattle,
  requestPlayerEndTurn,
  requestTrainingExit,
  resetTrainingBattle,
  startTrainingBattle,
} from '../core/battleEngine'
import {
  EndTurnConfirmation,
  TrainingExitConfirmation,
} from '../core/commands'
import type { BattleState } from '../core/contexts'
import {
  BattlePhase,
  PersonalTurnPhase,
  Position,
} from '../core/enums'
import type { BattleEvent } from '../core/events'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  SkillBranchId,
  UnitId,
} from '../core/identifiers'
import { createSeededRandomState } from '../core/rng'
import { createDefaultResourceConfiguration } from '../core/resources'
import { readSpecialCounter } from '../core/specialCounters'
import { createPositionProtectionSnapshot } from '../core/positionProtection'
import {
  calculateTrainingStatistics,
} from '../core/trainingStatistics'
import type { TrainingStatistics } from '../core/trainingStatistics'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
  isUnitAlive,
} from '../core/unitQueries'
import type { UnitState } from '../core/units'

export type WangDahaiAction = 'newTide' | 'stackingWave' | 'moonlitTide'
export type UiCharacterKey = 'wangDahai' | 'liMutou' | 'yanYan'
export type UiBossKey = 'trainingDummy'

interface UiCharacterDefinition {
  readonly key: UiCharacterKey
  readonly unitId: UnitId
  readonly name: string
  readonly create: () => UnitState
}

interface UiBossDefinition {
  readonly key: UiBossKey
  readonly unitId: UnitId
  readonly name: string
  readonly create: () => UnitState
}

export const UI_CHARACTER_DEFINITIONS: readonly UiCharacterDefinition[] = [
  {
    key: 'wangDahai',
    unitId: WANG_DAHAI_UNIT_ID,
    name: '王大海',
    create: createWangDahai,
  },
  {
    key: 'liMutou',
    unitId: LI_MUTOU_UNIT_ID,
    name: '李木头',
    create: createLiMutou,
  },
  {
    key: 'yanYan',
    unitId: YAN_YAN_UNIT_ID,
    name: '严岩',
    create: createYanYan,
  },
]

export const UI_BOSS_DEFINITIONS: readonly UiBossDefinition[] = [
  {
    key: 'trainingDummy',
    unitId: TRAINING_DUMMY_UNIT_ID,
    name: '训练假人',
    create: createTrainingDummy,
  },
]

export const UI_POSITION_OPTIONS = [
  { value: Position.Front1, label: '前1' },
  { value: Position.Front2, label: '前2' },
  { value: Position.Back1, label: '后1' },
  { value: Position.Back2, label: '后2' },
] as const

export interface UiTrainingBattleSetup {
  readonly characterKeys: readonly UiCharacterKey[]
  readonly positions: Readonly<Partial<Record<UiCharacterKey, Position>>>
  readonly bossKey: UiBossKey
}

export interface UiBattleResult {
  readonly ok: boolean
  readonly state: BattleState
  readonly reason?: string
}

export interface UiBattleAction {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly resourceCost: string
  readonly targetRule: string
  readonly description: string
  readonly effectDetails: readonly string[]
  readonly unavailableReason: string | null
}

export interface UiTrainingExitResult {
  readonly status: 'confirmationRequired' | 'cancelled' | 'exited' | 'invalid'
  readonly state: BattleState
  readonly returnToModeSelection: boolean
  readonly reason?: string
}

export interface UiTrainingResultView {
  readonly outcome: 'defeat'
  readonly state: BattleState
}

interface UiBattleActionDefinition {
  readonly id: string
  readonly actorId: UnitId
  readonly label: string
  readonly detail: string
  readonly resourceCost: string
  readonly targetRule: string
  readonly description: string
  readonly effectDetails: readonly string[]
  readonly skillIds: readonly string[]
  readonly unavailableReason: (state: BattleState, actor: UnitState) => string | null
  readonly execute: (state: BattleState, serial: number) => UiBattleResult
}

function createInitialState(
  units: readonly UnitState[],
  seed: number,
): BattleState {
  return {
    phase: BattlePhase.Setup,
    units,
    statusBatches: [],
    statusAcquisitionOrders: [],
    turnSequence: null,
    personalTurn: null,
    activeAction: null,
    activeSkill: null,
    completedSkillResolution: null,
    completedResourcePayment: null,
    resourcePaymentRegistry: {
      resourceTransactionIds: [],
      paidSkillExecutionIds: [],
    },
    resolutionIds: {
      skillExecutionIds: [],
      attackIds: [],
      damageEventIds: [],
    },
    resourceConfiguration: createDefaultResourceConfiguration(),
    actionRollbackState: null,
    rngState: createSeededRandomState(seed >>> 0),
    log: [],
    events: [],
  }
}

function getCharacterDefinition(
  key: UiCharacterKey,
): UiCharacterDefinition | undefined {
  return UI_CHARACTER_DEFINITIONS.find((definition) => definition.key === key)
}

function getBossDefinition(key: UiBossKey): UiBossDefinition | undefined {
  return UI_BOSS_DEFINITIONS.find((definition) => definition.key === key)
}

function createConfiguredUnits(
  setup: UiTrainingBattleSetup,
): readonly UnitState[] | string {
  if (setup.characterKeys.length < 1 || setup.characterKeys.length > 4) {
    return '请选择 1 至 4 名角色'
  }

  const selectedKeys = new Set(setup.characterKeys)
  if (selectedKeys.size !== setup.characterKeys.length) {
    return '同一角色不能重复选择'
  }

  const selectedPositions = setup.characterKeys.map((key) => setup.positions[key])
  if (selectedPositions.some((position) => position === undefined)) {
    return '请为每名角色选择站位'
  }
  if (new Set(selectedPositions).size !== selectedPositions.length) {
    return '每个站位只能配置一名角色'
  }

  const characters: UnitState[] = []
  for (const [deploymentOrder, key] of setup.characterKeys.entries()) {
    const definition = getCharacterDefinition(key)
    const position = setup.positions[key]
    if (definition === undefined || position === undefined) {
      return '所选角色当前不可用'
    }
    characters.push({
      ...definition.create(),
      position,
      deploymentOrder,
    })
  }

  const boss = getBossDefinition(setup.bossKey)
  if (boss === undefined) return '所选 Boss 当前不可用'
  return [...characters, boss.create()]
}

export function startUiTrainingBattle(
  setup: UiTrainingBattleSetup,
  seed: number,
): UiBattleResult {
  const units = createConfiguredUnits(setup)
  if (typeof units === 'string') {
    return {
      ok: false,
      state: createInitialState([], seed),
      reason: units,
    }
  }

  const initialState = createInitialState(units, seed)
  const result = startTrainingBattle(
    initialState,
    GAME_CONTENT_BATTLE_EXTENSIONS,
  )
  return result.ok
    ? { ok: true, state: result.state }
    : { ok: false, state: result.state, reason: result.reason }
}

export function startUiBattle(seed: number): UiBattleResult {
  return startUiTrainingBattle({
    characterKeys: ['wangDahai'],
    positions: { wangDahai: Position.Front1 },
    bossKey: 'trainingDummy',
  }, seed)
}

function idPrefix(serial: number): string {
  return `ui:wang-dahai:${serial}`
}

export function executeWangDahaiAction(
  state: BattleState,
  action: WangDahaiAction,
  serial: number,
): UiBattleResult {
  const prefix = idPrefix(serial)
  if (action === 'moonlitTide') {
    const result = resolveWangDahaiThirdSkill(
      state,
      {
        actionId: `${prefix}:action` as ActionId,
        skillExecutionId: `${prefix}:skill` as SkillExecutionId,
        resourceTransactionId: `${prefix}:resource` as ResourceTransactionId,
      },
      GAME_CONTENT_BATTLE_EXTENSIONS,
    )
    return result.ok
      ? { ok: true, state: result.state }
      : { ok: false, state: result.state, reason: result.reason }
  }

  const branchId = action === 'newTide'
    ? WANG_DAHAI_NEW_TIDE_BRANCH_ID
    : WANG_DAHAI_STACKING_WAVE_BRANCH_ID
  const result = resolveWangDahaiFirstSkill(
    state,
    {
      branchId,
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      actionId: `${prefix}:action` as ActionId,
      skillExecutionId: `${prefix}:skill` as SkillExecutionId,
      attackId: `${prefix}:attack` as AttackId,
      damageEventId: `${prefix}:damage` as DamageEventId,
      resourceTransactionId: `${prefix}:resource` as ResourceTransactionId,
    },
    GAME_CONTENT_BATTLE_EXTENSIONS,
  )
  return result.ok
    ? { ok: true, state: result.state }
    : { ok: false, state: result.state, reason: result.reason }
}

export function endWangDahaiTurn(state: BattleState): UiBattleResult {
  const result = requestPlayerEndTurn(
    state,
    {
      hasLegalAction: true,
      confirmation: EndTurnConfirmation.Confirmed,
    },
    GAME_CONTENT_BATTLE_EXTENSIONS,
  )
  return result.status === 'turnEnded'
    ? { ok: true, state: result.state }
    : {
        ok: false,
        state: result.state,
        reason: result.reason ?? `END_TURN_${result.status.toUpperCase()}`,
  }
}

function failure(state: BattleState, reason: string): UiBattleResult {
  return { ok: false, state, reason }
}

function actionResult(result: {
  readonly ok: boolean
  readonly state: BattleState
  readonly reason?: string
}): UiBattleResult {
  return result.ok
    ? { ok: true, state: result.state }
    : { ok: false, state: result.state, reason: result.reason ?? 'ACTION_FAILED' }
}

function getReadyPlayerUnit(state: BattleState): UnitState | null {
  const turn = state.personalTurn
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || state.activeAction !== null
  ) return null
  const unit = state.units.find((candidate) => candidate.id === turn.unitId)
  return unit !== undefined && unit.camp === 'player' && isUnitAlive(unit)
    ? unit
    : null
}

function getLivingEnemyTarget(
  state: BattleState,
  actorId: UnitId,
): UnitId | null {
  const actor = state.units.find((unit) => unit.id === actorId)
  if (actor === undefined) return null
  return state.units.find((unit) => (
    unit.camp !== actor.camp && isUnitAlive(unit)
  ))?.id ?? null
}

function targetUnavailableReason(state: BattleState, actorId: UnitId): string | null {
  return getLivingEnemyTarget(state, actorId) === null
    ? '没有存活的敌方目标'
    : null
}

function createUiActionIds(actorId: UnitId, serial: number, action: string) {
  const prefix = `ui:${String(actorId)}:${serial}:${action}`
  return {
    actionId: `${prefix}:action` as ActionId,
    skillExecutionId: `${prefix}:skill` as SkillExecutionId,
    attackId: `${prefix}:attack` as AttackId,
    damageEventId: `${prefix}:damage` as DamageEventId,
    resourceTransactionId: `${prefix}:resource` as ResourceTransactionId,
  }
}

function executeLiMutouFirst(
  state: BattleState,
  serial: number,
  branchId: SkillBranchId,
): UiBattleResult {
  const targetUnitId = getLivingEnemyTarget(state, LI_MUTOU_UNIT_ID)
  if (targetUnitId === null) return failure(state, '没有存活的敌方目标')
  const ids = createUiActionIds(LI_MUTOU_UNIT_ID, serial, String(branchId))
  return actionResult(resolveLiMutouFirstSkill(state, {
    branchId,
    targetUnitId,
    ...ids,
  }, GAME_CONTENT_BATTLE_EXTENSIONS))
}

function executeLiMutouSecond(state: BattleState, serial: number): UiBattleResult {
  const ids = createUiActionIds(LI_MUTOU_UNIT_ID, serial, 'blade-domain')
  return actionResult(resolveLiMutouSecondSkill(state, ids, GAME_CONTENT_BATTLE_EXTENSIONS))
}

function executeLiMutouThird(state: BattleState, serial: number): UiBattleResult {
  const targetUnitId = getLivingEnemyTarget(state, LI_MUTOU_UNIT_ID)
  if (targetUnitId === null) return failure(state, '没有存活的敌方目标')
  const ids = createUiActionIds(LI_MUTOU_UNIT_ID, serial, 'fallen-leaves')
  return actionResult(resolveLiMutouThirdSkill(state, {
    targetUnitId,
    ...ids,
  }, GAME_CONTENT_BATTLE_EXTENSIONS))
}

function executeYanYanSingleTarget(
  state: BattleState,
  serial: number,
  action: 'guard' | 'ridges',
): UiBattleResult {
  const targetUnitId = getLivingEnemyTarget(state, YAN_YAN_UNIT_ID)
  if (targetUnitId === null) return failure(state, '没有存活的敌方目标')
  const ids = createUiActionIds(YAN_YAN_UNIT_ID, serial, action)
  const result = action === 'guard'
    ? resolveYanYanFirstSkill(state, { targetUnitId, ...ids }, GAME_CONTENT_BATTLE_EXTENSIONS)
    : resolveYanYanRidgesSkill(state, { targetUnitId, ...ids }, GAME_CONTENT_BATTLE_EXTENSIONS)
  return actionResult(result)
}

function executeYanYanPeaks(state: BattleState, serial: number): UiBattleResult {
  const ids = createUiActionIds(YAN_YAN_UNIT_ID, serial, 'peaks')
  return actionResult(resolveYanYanPeaksSkill(state, {
    actionId: ids.actionId,
    skillExecutionId: ids.skillExecutionId,
    resourceTransactionId: ids.resourceTransactionId,
  }, GAME_CONTENT_BATTLE_EXTENSIONS))
}

function executeYanYanBaiyue(state: BattleState, serial: number): UiBattleResult {
  const ids = createUiActionIds(YAN_YAN_UNIT_ID, serial, 'baiyue')
  return actionResult(resolveYanYanBaiyueSkill(state, {
    actionId: ids.actionId,
    skillExecutionId: ids.skillExecutionId,
    normalAttackId: `${ids.attackId}:normal` as AttackId,
    shieldAttackId: `${ids.attackId}:shield` as AttackId,
    resourceTransactionId: ids.resourceTransactionId,
  }, GAME_CONTENT_BATTLE_EXTENSIONS))
}

const UI_BATTLE_ACTION_DEFINITIONS: readonly UiBattleActionDefinition[] = [
  {
    id: 'wangDahai.newTide', actorId: WANG_DAHAI_UNIT_ID,
    label: '新潮式', detail: '无消耗 · 单体伤害 · 结束回合',
    resourceCost: '无消耗', targetRule: '选择 1 名存活敌方',
    description: '造成单体伤害，并降低目标的势。',
    effectDetails: [
      '资源：获得 2 点能量、1 点势',
      '伤害：攻击×1；命中 1 段',
      '条件：施放前自身势不超过 1 时，目标势减半（向远离 0 取整）',
    ],
    skillIds: [WANG_DAHAI_FIRST_SKILL_ID],
    unavailableReason: (state) => getActionUnavailableReason(state, 'newTide'),
    execute: (state, serial) => executeWangDahaiAction(state, 'newTide', serial),
  },
  {
    id: 'wangDahai.stackingWave', actorId: WANG_DAHAI_UNIT_ID,
    label: '叠浪式', detail: '1 能量 · 连续行动 · 叠加势',
    resourceCost: '1 能量', targetRule: '选择 1 名存活敌方',
    description: '造成单体伤害、获得势，并可继续行动。',
    effectDetails: [
      '资源：消耗 1 点能量；获得势为本回合本技能使用次数×2，最多 6 点',
      '伤害：攻击×0.5；命中 1 段',
      '条件：本回合首次施放后锁定其他主动技能；施放后不结束回合',
    ],
    skillIds: [WANG_DAHAI_FIRST_SKILL_ID],
    unavailableReason: (state) => getActionUnavailableReason(state, 'stackingWave'),
    execute: (state, serial) => executeWangDahaiAction(state, 'stackingWave', serial),
  },
  {
    id: 'wangDahai.moonlitTide', actorId: WANG_DAHAI_UNIT_ID,
    label: '月海潮生', detail: '5 能量 · 获得暴击强化与 2 层海潮',
    resourceCost: '5 能量', targetRule: '自身',
    description: '获得暴击强化，并获得 2 层海潮。',
    effectDetails: [
      '资源：消耗 5 点能量；获得 2 层海潮',
      '强化：暴击率 +20%，暴击伤害 +50%，持续 2 个自身回合',
      '伤害：无直接伤害；施放后不结束回合',
    ],
    skillIds: [WANG_DAHAI_THIRD_SKILL_ID],
    unavailableReason: (state) => getActionUnavailableReason(state, 'moonlitTide'),
    execute: (state, serial) => executeWangDahaiAction(state, 'moonlitTide', serial),
  },
  {
    id: 'liMutou.spring', actorId: LI_MUTOU_UNIT_ID,
    label: '一叶春', detail: '单体伤害 · 获得能量、势与春华 · 结束回合',
    resourceCost: '无消耗', targetRule: '选择 1 名存活敌方',
    description: '造成单体伤害，获得能量、势与春华。',
    effectDetails: [
      '资源：获得 2 点能量、3 点势',
      '伤害：攻击×0.8；命中 1 段',
      '状态：添加 1 层春华，持续至被消耗',
    ],
    skillIds: [LI_MUTOU_FIRST_SKILL_ID],
    unavailableReason: (state) => targetUnavailableReason(state, LI_MUTOU_UNIT_ID),
    execute: (state, serial) => executeLiMutouFirst(state, serial, LI_MUTOU_SPRING_BRANCH_ID),
  },
  {
    id: 'liMutou.autumn', actorId: LI_MUTOU_UNIT_ID,
    label: '一叶秋', detail: '两段单体伤害 · 获得能量、势与秋实 · 结束回合',
    resourceCost: '无消耗', targetRule: '选择 1 名存活敌方',
    description: '进行两段单体伤害，获得能量、势与秋实。',
    effectDetails: [
      '资源：获得 1 点能量、4 点势',
      '伤害：攻击×0.5，命中 2 段',
      '状态：添加 1 层秋实，持续至被消耗',
    ],
    skillIds: [LI_MUTOU_FIRST_SKILL_ID],
    unavailableReason: (state) => targetUnavailableReason(state, LI_MUTOU_UNIT_ID),
    execute: (state, serial) => executeLiMutouFirst(state, serial, LI_MUTOU_AUTUMN_BRANCH_ID),
  },
  {
    id: 'liMutou.bladeDomain', actorId: LI_MUTOU_UNIT_ID,
    label: '刀域·无边木叶', detail: '2 能量 · 开启领域 · 不结束回合',
    resourceCost: '2 能量', targetRule: '自身',
    description: '开启刀域，行动后不结束回合。',
    effectDetails: [
      '资源：消耗 2 点能量',
      '状态：添加 1 层刀域，能量耗尽时移除',
      '伤害：无直接伤害；施放后不结束回合',
    ],
    skillIds: [LI_MUTOU_SECOND_SKILL_ID],
    unavailableReason: (_state, actor) => (
      readSpecialCounter(actor, LI_MUTOU_BLADE_DOMAIN_COUNTER_ID) > 0
        ? '刀域已开启'
        : actor.energy < 2 ? '能量不足（需要 2）' : null
    ),
    execute: executeLiMutouSecond,
  },
  {
    id: 'liMutou.fallenLeaves', actorId: LI_MUTOU_UNIT_ID,
    label: '千山落木', detail: '刀域期间 · 消耗所有能量进行多段攻击 · 结束回合',
    resourceCost: '无预付消耗（需至少 1 能量）', targetRule: '选择 1 名存活敌方',
    description: '刀域期间按当前能量进行多段攻击。',
    effectDetails: [
      '资源：按施放时能量决定段数；结算后能量设为 2、势设为 6',
      '伤害：每段攻击×0.5；命中段数 = 当前能量',
      '条件：需要刀域且至少 1 点能量；前 6 段附加刀域额外伤害',
    ],
    skillIds: [LI_MUTOU_THIRD_SKILL_ID],
    unavailableReason: (state, actor) => {
      if (readSpecialCounter(actor, LI_MUTOU_BLADE_DOMAIN_COUNTER_ID) < 1) return '需要先开启刀域'
      if (actor.energy < 1) return '能量不足（需要至少 1）'
      return targetUnavailableReason(state, LI_MUTOU_UNIT_ID)
    },
    execute: executeLiMutouThird,
  },
  {
    id: 'yanYan.guard', actorId: YAN_YAN_UNIT_ID,
    label: '镇山岳', detail: '单体伤害 · 获得资源与护盾 · 结束回合',
    resourceCost: '无消耗', targetRule: '选择 1 名存活敌方',
    description: '造成单体伤害，并获得资源与护盾。',
    effectDetails: [
      '资源：获得 1 点能量、2 点势',
      '伤害：攻击×0.8；命中 1 段',
      '护盾：自身获得 10 + 当前势 点护盾，并向其他存活友方各提供当前势点护盾',
    ],
    skillIds: [YAN_YAN_FIRST_SKILL_ID],
    unavailableReason: (state) => targetUnavailableReason(state, YAN_YAN_UNIT_ID),
    execute: (state, serial) => executeYanYanSingleTarget(state, serial, 'guard'),
  },
  {
    id: 'yanYan.peaks', actorId: YAN_YAN_UNIT_ID,
    label: '峰峦起', detail: '获得势并为全体友方提供护盾 · 结束回合',
    resourceCost: '无消耗', targetRule: '全体友方',
    description: '获得势，并为全体友方提供护盾。',
    effectDetails: [
      '资源：自身获得施放前势的一半（四舍五入）',
      '护盾：所有存活友方各获得结算后当前势点护盾',
      '伤害：无直接伤害',
    ],
    skillIds: [YAN_YAN_PEAKS_SKILL_ID],
    unavailableReason: () => null,
    execute: executeYanYanPeaks,
  },
  {
    id: 'yanYan.ridges', actorId: YAN_YAN_UNIT_ID,
    label: '层峦叠嶂', detail: '1 能量、5 势 · 单体伤害与削势 · 结束回合',
    resourceCost: '1 能量、5 势', targetRule: '选择 1 名存活敌方',
    description: '造成单体伤害，并降低目标的势。',
    effectDetails: [
      '资源：消耗 1 点能量、5 点势',
      '伤害：攻击×1；命中 1 段',
      '效果：目标最多失去 4 点势；若本次消耗了势，自身与友方获得等同于消耗势的护盾',
    ],
    skillIds: [YAN_YAN_RIDGES_SKILL_ID],
    unavailableReason: (state, actor) => {
      if (actor.energy < 1 || actor.momentum < 5) return '能量或势不足（需要 1 能量、5 势）'
      return targetUnavailableReason(state, YAN_YAN_UNIT_ID)
    },
    execute: (state, serial) => executeYanYanSingleTarget(state, serial, 'ridges'),
  },
  {
    id: 'yanYan.baiyue', actorId: YAN_YAN_UNIT_ID,
    label: '拜岳凿天', detail: '消耗全部势 · 攻击全体敌方并结算护盾伤害 · 结束回合',
    resourceCost: '消耗全部势', targetRule: '全体存活敌方',
    description: '攻击全体敌方，并按护盾结算额外伤害。',
    effectDetails: [
      '资源：消耗施放时全部势；下个自身回合返还其中一半（四舍五入）',
      '伤害：每个目标受到攻击×0.5 + 消耗势×2 的普通伤害，以及当前护盾值的护盾值伤害',
      '目标：每名存活敌方各结算上述 2 段伤害；自身与友方获得等同于消耗势的护盾',
    ],
    skillIds: [YAN_YAN_BAIYUE_SKILL_ID],
    unavailableReason: (state, actor) => {
      if (actor.momentum < 1) return '势不足（需要至少 1）'
      return targetUnavailableReason(state, YAN_YAN_UNIT_ID)
    },
    execute: executeYanYanBaiyue,
  },
]

export function getUiBattleActions(
  state: BattleState | null,
): readonly UiBattleAction[] {
  if (state === null) return []
  const actor = getReadyPlayerUnit(state)
  if (actor === null) return []
  return UI_BATTLE_ACTION_DEFINITIONS
    .filter((action) => action.actorId === actor.id)
    .map((action) => ({
      id: action.id,
      label: action.label,
      detail: action.detail,
      resourceCost: action.resourceCost,
      targetRule: action.targetRule,
      description: action.description,
      effectDetails: action.effectDetails,
      unavailableReason: action.unavailableReason(state, actor),
    }))
}

export function executeUiBattleAction(
  state: BattleState,
  actionId: string,
  serial: number,
): UiBattleResult {
  const actor = getReadyPlayerUnit(state)
  const action = UI_BATTLE_ACTION_DEFINITIONS.find((candidate) => (
    candidate.id === actionId && candidate.actorId === actor?.id
  ))
  if (action === undefined || actor === null) {
    return failure(state, '当前没有可执行的玩家技能')
  }
  const reason = action.unavailableReason(state, actor)
  if (reason !== null) return failure(state, reason)
  return action.execute(state, serial)
}

export function endUiPlayerTurn(state: BattleState): UiBattleResult {
  const result = requestPlayerEndTurn(
    state,
    {
      hasLegalAction: true,
      confirmation: EndTurnConfirmation.Confirmed,
    },
    GAME_CONTENT_BATTLE_EXTENSIONS,
  )
  return result.status === 'turnEnded'
    ? { ok: true, state: result.state }
    : {
        ok: false,
        state: result.state,
        reason: result.reason ?? `END_TURN_${result.status.toUpperCase()}`,
      }
}

export function pauseUiTrainingBattle(state: BattleState): UiBattleResult {
  return actionResult(pauseTrainingBattle(state))
}

export function resetUiTrainingBattle(state: BattleState): UiBattleResult {
  return actionResult(resetTrainingBattle(state, GAME_CONTENT_BATTLE_EXTENSIONS))
}

export function requestUiTrainingExit(
  state: BattleState,
  confirmation: TrainingExitConfirmation,
): UiTrainingExitResult {
  const result = requestTrainingExit(state, confirmation)
  return {
    status: result.status,
    state: result.state,
    returnToModeSelection: result.returnToModeSelection,
    reason: result.reason,
  }
}

export function getUiTrainingStatistics(state: BattleState): TrainingStatistics {
  return calculateTrainingStatistics(state)
}

export function isUiTrainingResultReady(state: BattleState): boolean {
  return state.phase === BattlePhase.Finished
    && state.events.some((event) => event.type === 'TRAINING_FINISHED')
}

export function getUiTrainingPauseReason(
  state: BattleState,
): 'ALL_PLAYER_UNITS_DEFEATED' | 'MANUAL_PAUSE' | null {
  if (state.phase !== BattlePhase.Paused) return null
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]
    if (event.type === 'TRAINING_PAUSED') return event.reason
  }
  return null
}

export function resumeUiTrainingBattle(
  pausedState: BattleState,
  stateBeforeManualPause: BattleState,
): UiBattleResult {
  if (getUiTrainingPauseReason(pausedState) !== 'MANUAL_PAUSE') {
    return failure(pausedState, 'TRAINING_PAUSE_CANNOT_RESUME')
  }
  return { ok: true, state: stateBeforeManualPause }
}

export function endUiTrainingBattleAsDefeat(
  state: BattleState,
): UiTrainingResultView | null {
  if (state.trainingSession === null || state.trainingSession === undefined) return null
  return { outcome: 'defeat', state }
}

function getReadyWangDahai(state: BattleState): UnitState | null {
  const turn = state.personalTurn
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== WANG_DAHAI_UNIT_ID
    || state.activeAction !== null
  ) return null
  return state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID) ?? null
}

export function getActionUnavailableReason(
  state: BattleState | null,
  action: WangDahaiAction | 'endTurn',
): string | null {
  if (state === null) return '请先开始战斗'
  const wangDahai = state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
  if (wangDahai === undefined || !isUnitAlive(wangDahai)) return '王大海已无法行动'
  if (getReadyWangDahai(state) === null) return '当前不是王大海的可行动阶段'
  if (action === 'endTurn') return null

  const dummy = state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID)
  if (action !== 'moonlitTide' && (dummy === undefined || !isUnitAlive(dummy))) {
    return '没有存活的敌方目标'
  }

  const branchId: SkillBranchId | undefined = action === 'newTide'
    ? WANG_DAHAI_NEW_TIDE_BRANCH_ID
    : action === 'stackingWave'
      ? WANG_DAHAI_STACKING_WAVE_BRANCH_ID
      : undefined
  const skillId = action === 'moonlitTide'
    ? WANG_DAHAI_THIRD_SKILL_ID
    : WANG_DAHAI_FIRST_SKILL_ID
  if (!isWangDahaiActiveSkillAllowed(wangDahai, skillId, branchId)) {
    return '叠浪式已锁定本回合的其他主动技能'
  }
  if (action === 'stackingWave' && wangDahai.energy < STACKING_WAVE_ENERGY_COST) {
    return `能量不足（需要 ${STACKING_WAVE_ENERGY_COST}）`
  }
  if (action === 'moonlitTide' && wangDahai.energy < MOONLIT_TIDE_ENERGY_COST) {
    return `能量不足（需要 ${MOONLIT_TIDE_ENERGY_COST}）`
  }
  return null
}

export function getTide(unit: UnitState): number {
  return readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)
}

export const UI_PLAYER_FORMATION_SLOTS = [
  Position.Front1,
  Position.Front2,
  Position.Back1,
  Position.Back2,
] as const

export function getUiPlayerFormationSlots(
  units: readonly UnitState[],
): readonly (UnitState | null)[] {
  return UI_PLAYER_FORMATION_SLOTS.map((position) => (
    units.find((unit) => unit.camp === 'player' && unit.position === position)
      ?? null
  ))
}

export function getUiHealthText(unit: UnitState): string {
  return `${unit.currentHealth}/${unit.maximumHealth}`
}

export function getUiShieldShellProgress(unit: UnitState): number | null {
  if (
    unit.hasInfiniteHealth
    || !Number.isFinite(unit.maximumHealth)
    || unit.maximumHealth <= 0
    || unit.shield <= 0
  ) return null
  return Math.min(unit.shield / (unit.maximumHealth * 2), 1)
}

export interface UiUnitDetailField {
  readonly label: string
  readonly value: string | number
}

export interface UiUnitDetails {
  readonly commonFields: readonly UiUnitDetailField[]
  readonly exclusiveFields: readonly UiUnitDetailField[]
  readonly statusDetails: readonly string[]
}

export const UNIT_DETAIL_SCROLL_STYLE = {
  maxHeight: '118px',
  overflowY: 'auto',
} as const

function formatPercentage(value: number): string {
  return `${value * 100}%`
}

function getNormalDamageIncrease(unit: UnitState): number {
  return unit.normalDamageIncrease + (unit.normalDamageIncreaseSources ?? []).reduce(
    (total, source) => total + source.modifier,
    0,
  )
}

function getNormalDamageReduction(state: BattleState, unit: UnitState): number {
  const unitReduction = unit.normalDamageReductionSources.reduce(
    (total, source) => total + source.reduction,
    0,
  )
  const positionReduction = createPositionProtectionSnapshot(state.units, [unit.id])[0]?.reduction ?? 0
  return unitReduction + positionReduction
}

function getExclusiveUiUnitDetails(unit: UnitState): readonly UiUnitDetailField[] {
  if (unit.id === WANG_DAHAI_UNIT_ID) {
    return [{ label: '海潮', value: readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID) }]
  }
  if (unit.id === LI_MUTOU_UNIT_ID) {
    const bladeDomain = readSpecialCounter(unit, LI_MUTOU_BLADE_DOMAIN_COUNTER_ID)
    return [{
      label: '刀域',
      value: bladeDomain > 0 ? `开启（${bladeDomain} 层）` : '未开启',
    }]
  }
  return []
}

export function getUiUnitDetails(
  state: BattleState,
  unitId: UnitId,
): UiUnitDetails | null {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) return null
  return {
    commonFields: [
      { label: '当前攻击', value: getEffectiveAttack(unit) },
      { label: '增伤', value: formatPercentage(getNormalDamageIncrease(unit)) },
      { label: '减伤', value: formatPercentage(getNormalDamageReduction(state, unit)) },
      { label: '护盾', value: unit.shield },
      { label: '暴击率', value: formatPercentage(getEffectiveCriticalRate(unit)) },
      { label: '暴击伤害', value: formatPercentage(getEffectiveCriticalDamage(unit)) },
      { label: '能量', value: unit.energy },
      { label: '势', value: unit.momentum },
      { label: '势压', value: unit.momentumPressure },
    ],
    exclusiveFields: getExclusiveUiUnitDetails(unit),
    statusDetails: getUiUnitStatusDetails(state, unitId),
  }
}

export function getUiUnitStatusDetails(
  state: BattleState,
  unitId: UnitId,
): readonly string[] {
  const statusGroups = new Map<string, {
    readonly name: string
    readonly remainingOwnerTurns: number | null
    stacks: number
  }>()
  for (const status of state.statusBatches) {
    if (status.ownerUnitId !== unitId) continue
    const name = statusName(status.statusId)
    const key = `${name}:${status.remainingOwnerTurns}`
    const existing = statusGroups.get(key)
    if (existing === undefined) {
      statusGroups.set(key, {
        name,
        remainingOwnerTurns: status.remainingOwnerTurns,
        stacks: status.stacks,
      })
    } else {
      existing.stacks += status.stacks
    }
  }
  const statuses = [...statusGroups.values()].map((status) => (
    `${status.name}（${status.stacks}层），${statusDurationLabel(status.remainingOwnerTurns)}`
  ))
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) return statuses
  const modifierGroups = new Map<string, {
    readonly attribute: 'attack' | 'criticalRate' | 'criticalDamage'
    readonly duration: typeof unit.temporaryAttributeModifiers[number]['duration']
    value: number
    stacks: number
  }>()
  for (const modifier of unit.temporaryAttributeModifiers) {
    const durationKey = modifier.duration.kind === 'ownerTurns'
      ? `ownerTurns:${modifier.duration.remainingTurns}`
      : `currentPersonalTurn:${modifier.duration.personalTurnId}`
    const key = `${modifier.attribute}:${durationKey}`
    const existing = modifierGroups.get(key)
    if (existing === undefined) {
      modifierGroups.set(key, {
        attribute: modifier.attribute,
        duration: modifier.duration,
        value: modifier.value,
        stacks: 1,
      })
    } else {
      existing.value += modifier.value
      existing.stacks += 1
    }
  }
  return [
    ...statuses,
    ...[...modifierGroups.values()].map((modifier) => {
      const name = modifier.attribute === 'criticalRate'
        ? '暴击率'
        : modifier.attribute === 'criticalDamage' ? '暴击伤害' : '攻击力'
      const value = modifier.attribute === 'attack'
        ? modifier.value
        : formatPercentage(modifier.value)
      const duration = modifier.duration.kind === 'ownerTurns'
        ? `持续${modifier.duration.remainingTurns}回合`
        : '持续当前回合'
      return `${name}+${value}（${modifier.stacks}层），${duration}`
    }),
  ]
}

function statusDurationLabel(remainingOwnerTurns: number | null): string {
  return remainingOwnerTurns === null
    ? '持续至被消耗'
    : `持续${remainingOwnerTurns}回合`
}

export function getUnitName(state: BattleState, unitId: UnitId): string {
  return state.units.find((unit) => unit.id === unitId)?.name ?? String(unitId)
}

export interface UiBattleEvent {
  readonly kind: 'action' | 'trigger'
  readonly text: string
}

interface UiSkillContext {
  readonly casterId: UnitId
  readonly skillId: string
  readonly branchId: string | null | undefined
  readonly resolutionKind: 'manual' | 'automatic' | 'passive' | 'reaction'
  readonly targetIds: readonly UnitId[]
}

function eventSkillExecutionId(event: BattleEvent): SkillExecutionId | null {
  switch (event.type) {
    case 'DAMAGE_CALCULATED':
    case 'EXTRA_DAMAGE_APPLIED':
      return event.damage.skillExecutionId
    case 'SHIELD_GAINED':
    case 'HEALTH_RESTORED':
    case 'TEMPORARY_ATTRIBUTE_CHANGED':
    case 'RESOURCE_GAINED':
    case 'RESOURCE_SPENT':
    case 'RESOURCE_SET':
    case 'RESOURCE_REDUCTION_PREVENTED':
    case 'SPECIAL_COUNTER_CHANGED':
    case 'STATUS_ACQUIRED':
    case 'STATUS_BATCH_MERGED':
    case 'STATUS_DURATION_REFRESHED':
    case 'STATUS_BATCH_REPLACED':
    case 'STATUS_REJECTED':
    case 'STATUS_STACK_REMOVED':
    case 'STATUS_BATCH_REMOVED':
    case 'STATUS_DURATION_DECREMENTED':
    case 'STATUS_CLEANSED':
    case 'STATUS_DISPELLED':
    case 'STATUS_REMOVED':
      return event.skillExecutionId
    default:
      return null
  }
}

function statusDurationText(remainingOwnerTurns: number | null): string {
  return remainingOwnerTurns === null
    ? '持续至被消耗'
    : `持续${remainingOwnerTurns}个自身回合`
}

function counterName(counterId: string): string {
  return displayCounterName(counterId) ?? '未命名计数'
}

export function getUiBattleEvents(state: BattleState): readonly UiBattleEvent[] {
  return groupUiBattleEventsByAction(state.events)
    .map((group) => formatUiBattleEventGroup(state, group.events))
    .filter((event): event is UiBattleEvent => event !== null)
}

function formatUiBattleEventGroup(
  state: BattleState,
  events: readonly BattleEvent[],
): UiBattleEvent | null {
  const skills = new Map<SkillExecutionId, UiSkillContext>()
  const attacks = new Map<AttackId, import('../core/contexts').AttackContext>()
  let primarySkillExecutionId: SkillExecutionId | null = null
  let pressureSourceId: UnitId | null = null
  let standaloneSourceId: UnitId | null = null
  let standaloneEffectId: string | null = null

  for (const event of events) {
    if (event.type === 'SKILL_RESOLUTION_STARTED') {
      skills.set(event.skillExecutionId, {
        casterId: event.casterId,
        skillId: event.skillId,
        branchId: event.context?.branchId,
        resolutionKind: event.resolutionKind,
        targetIds: event.context?.targetIds ?? [],
      })
      primarySkillExecutionId ??= event.skillExecutionId
    }
    if (event.type === 'ATTACK_STARTED') attacks.set(event.context.attackId, event.context)
    if (event.type === 'MOMENTUM_PRESSURE_TRIGGERED') pressureSourceId = event.sourceUnitId
    if (
      event.type === 'EXTRA_DAMAGE_APPLIED'
      && event.damage.extraDamageSource === 'momentumPressure'
    ) pressureSourceId = event.damage.sourceUnitId
    if (standaloneSourceId !== null) continue
    switch (event.type) {
      case 'SHIELD_GAINED':
      case 'HEALTH_RESTORED':
      case 'RESOURCE_GAINED':
      case 'RESOURCE_SPENT':
      case 'STATUS_ACQUIRED':
      case 'STATUS_BATCH_MERGED':
      case 'STATUS_DURATION_REFRESHED':
      case 'STATUS_BATCH_REPLACED':
        if (event.skillExecutionId === null && event.sourceUnitId !== null && event.effectId !== null) {
          standaloneSourceId = event.sourceUnitId
          standaloneEffectId = event.effectId
        }
        break
      default:
        break
    }
  }

  const skill = primarySkillExecutionId === null
    ? null
    : skills.get(primarySkillExecutionId) ?? null
  const actorId = skill?.casterId ?? pressureSourceId ?? standaloneSourceId
  if (actorId === null) return null

  const resultEvents = events.filter((event) => {
    if (skill !== null) return eventSkillExecutionId(event) === primarySkillExecutionId
    if (pressureSourceId !== null) {
      return event.type === 'EXTRA_DAMAGE_APPLIED'
        && event.damage.extraDamageSource === 'momentumPressure'
    }
    return isStandaloneUiResult(event, standaloneSourceId, standaloneEffectId)
  })
  const damageTargetIds = resultEvents.flatMap((event) => (
    event.type === 'DAMAGE_CALCULATED' || event.type === 'EXTRA_DAMAGE_APPLIED'
      ? [event.damage.targetUnitId]
      : []
  ))
  const targetIds = skill !== null && skill.targetIds.length > 0
    ? skill.targetIds
    : damageTargetIds
  const fragments = resultEvents
    .map((event) => formatUiEventFragment(state, event, actorId, attacks, targetIds.length > 1))
    .filter((fragment): fragment is string => fragment !== null)

  const header = skill === null
    ? pressureSourceId !== null
      ? `${getUnitName(state, actorId)}的势压被触发`
      : standaloneEffectId === null
        ? null
        : standaloneTriggerHeader(state, actorId, standaloneEffectId)
    : skillHeader(state, skill)
  if (header === null) return null
  if (pressureSourceId !== null && fragments.length === 0) return null
  const targetText = targetIds.length === 0
    ? ''
    : `，目标：${targetIds.map((targetId) => getUnitName(state, targetId)).join('、')}`
  const resultText = fragments.join('、')
  return {
    kind: skill?.resolutionKind === 'manual' ? 'action' : 'trigger',
    text: fragments.length === 0
      ? `${header}${targetText}。`
      : `${header}${targetText}。${resultText}${
        resultText.endsWith('！') || resultText.includes('点伤害！') ? '' : '。'
      }`,
  }
}

function isStandaloneUiResult(
  event: BattleEvent,
  sourceUnitId: UnitId | null,
  effectId: string | null,
): boolean {
  switch (event.type) {
    case 'SHIELD_GAINED':
    case 'HEALTH_RESTORED':
    case 'RESOURCE_GAINED':
    case 'RESOURCE_SPENT':
    case 'STATUS_ACQUIRED':
    case 'STATUS_BATCH_MERGED':
    case 'STATUS_DURATION_REFRESHED':
    case 'STATUS_BATCH_REPLACED':
      return event.skillExecutionId === null
        && event.sourceUnitId === sourceUnitId
        && event.effectId === effectId
    default:
      return false
  }
}

function skillHeader(state: BattleState, skill: UiSkillContext): string | null {
  const name = displaySkillName(skill.skillId, skill.branchId)
  if (name === null) return null
  const casterName = getUnitName(state, skill.casterId)
  return skill.resolutionKind === 'manual'
    ? `${casterName}释放了${name}`
    : `${casterName}的${name}被触发`
}

function standaloneTriggerHeader(
  state: BattleState,
  sourceUnitId: UnitId,
  effectId: string,
): string | null {
  const name = displayEffectName(effectId)
    ?? displayStatusName(effectId)
    ?? displaySkillName(effectId)
  return name === null ? null : `${getUnitName(state, sourceUnitId)}的${name}被触发`
}

function formatUiEventFragment(
  state: BattleState,
  event: BattleEvent,
  actorId: UnitId,
  attacks: ReadonlyMap<AttackId, import('../core/contexts').AttackContext>,
  showDamageTarget: boolean,
): string | null {
  const recipient = (unitId: UnitId): string => (
    unitId === actorId ? '' : `为${getUnitName(state, unitId)}`
  )
  switch (event.type) {
    case 'DAMAGE_CALCULATED':
    case 'EXTRA_DAMAGE_APPLIED': {
      const attack = event.damage.attackId === null
        ? undefined
        : attacks.get(event.damage.attackId)
      const segment = attack === undefined
        ? ''
        : `（第${attack.attackIndex + 1}段${attack.damageType === 'shieldValue' ? '护盾值' : ''}伤害）`
      return `${showDamageTarget ? `对${getUnitName(state, event.damage.targetUnitId)}` : ''}造成了${
        event.damage.resolvedValue
      }点伤害！${segment}${event.damage.critical ? '（暴击）' : ''}`
    }
    case 'SHIELD_GAINED':
      return `${recipient(event.unitId)}获得了${event.amount}点护盾`
    case 'HEALTH_RESTORED':
      return `${recipient(event.unitId)}恢复了${event.amount}点生命值`
    case 'RESOURCE_GAINED':
    case 'RESOURCE_SPENT':
      return `${event.reason === 'wangDahaiRisingMomentum'
        && event.effectId === event.reason
        && event.sourceUnitId !== null
        && event.actionId !== null
        && event.skillExecutionId !== null
        ? `${displayEffectName(event.effectId) ?? event.reason}：`
        : ''}${recipient(event.unitId)}${event.type === 'RESOURCE_GAINED' ? '获得了' : '消耗了'}${
        event.amount
      }点${resourceName(event.resourceType)}`
    case 'SPECIAL_COUNTER_CHANGED':
      return event.operation === 'increase'
        ? `${recipient(event.unitId)}获得了${event.amount}层${counterName(event.counterId)}`
        : `${recipient(event.unitId)}消耗了${event.amount}层${counterName(event.counterId)}`
    case 'STATUS_ACQUIRED':
    case 'STATUS_BATCH_MERGED':
    case 'STATUS_DURATION_REFRESHED':
    case 'STATUS_BATCH_REPLACED': {
      const name = displayStatusName(event.statusId)
      return name === null
        ? null
        : `${recipient(event.ownerUnitId)}获得了${event.stacks}层${name}，${
          statusDurationText(event.remainingOwnerTurns)
        }`
    }
    case 'TEMPORARY_ATTRIBUTE_CHANGED':
      return event.operation === 'applied'
        ? `${recipient(event.unitId)}获得${attributeName(event.attribute)}+${event.value}，${
          statusDurationText(event.remainingOwnerTurns)
        }`
        : null
    default:
      return null
  }
}

export function formatBattleEvent(
  state: BattleState,
  event: BattleEvent,
): string {
  switch (event.type) {
    case 'SEQUENCE_STARTED':
      return `第 ${event.sequenceNumber} 轮开始`
    case 'SEQUENCE_COMPLETED':
      return `第 ${event.sequenceNumber} 轮结束`
    case 'TURN_STARTED':
      return `${getUnitName(state, event.unitId)}的回合开始`
    case 'TURN_ENDED':
      return `${getUnitName(state, event.unitId)}的回合结束`
    case 'ACTION_STARTED':
      return `${getUnitName(state, event.unitId)}开始行动${event.endsTurn ? '（行动后结束回合）' : ''}`
    case 'ACTION_COMPLETED':
      return `${getUnitName(state, event.unitId)}完成行动`
    case 'SKILL_RESOLUTION_STARTED':
      return `${getUnitName(state, event.casterId)}使用${skillName(event.skillId, event.context?.branchId)}`
    case 'DAMAGE_CALCULATED':
    case 'EXTRA_DAMAGE_APPLIED':
      return `${getUnitName(state, event.damage.sourceUnitId)}对${getUnitName(state, event.damage.targetUnitId)}造成 ${event.damage.resolvedValue} 点${event.damage.damageType === 'extra' ? '额外' : ''}伤害`
    case 'CRITICAL_ROLLED':
      return `${getUnitName(state, event.targetId)}：${event.critical ? '暴击！' : '未暴击'}`
    case 'HEALTH_LOST':
      return `${getUnitName(state, event.targetId)}失去 ${event.amount} 点生命`
    case 'SHIELD_ABSORBED':
      return `${getUnitName(state, event.targetId)}的护盾吸收 ${event.amount} 点伤害`
    case 'UNIT_DIED':
      return `${getUnitName(state, event.unitId)}倒下了`
    case 'RESOURCE_GAINED':
      return `${getUnitName(state, event.unitId)}获得 ${event.amount} ${resourceName(event.resourceType)}`
    case 'RESOURCE_SPENT':
      return `${getUnitName(state, event.unitId)}消耗 ${event.amount} ${resourceName(event.resourceType)}`
    case 'RESOURCE_REDUCTION_PREVENTED':
      return `${getUnitName(state, event.unitId)}的${resourceName(event.resourceType)}减少被阻止`
    case 'RESOURCE_SET':
      return `${getUnitName(state, event.unitId)}的${resourceName(event.resourceType)}变为 ${event.after}`
    case 'SHIELD_GAINED':
      return `${getUnitName(state, event.unitId)}获得 ${event.amount} 点护盾`
    case 'SPECIAL_COUNTER_CHANGED':
      if (event.counterId === WANG_DAHAI_TIDE_COUNTER_ID) {
        return `王大海的海潮变为 ${event.after} 层`
      }
      return `${getUnitName(state, event.unitId)}的特殊计数发生变化`
    case 'TEMPORARY_ATTRIBUTE_CHANGED':
      return `${getUnitName(state, event.unitId)}的临时${attributeName(event.attribute)}${modifierOperationName(event.operation)}`
    case 'MOMENTUM_PRESSURE_TRIGGERED':
      return `势压对${getUnitName(state, event.targetUnitId)}造成 ${event.extraDamage} 点额外伤害`
    case 'HEALTH_RESTORED':
      return `${getUnitName(state, event.unitId)}恢复 ${event.amount} 点生命`
    case 'STATUS_ACQUIRED':
    case 'STATUS_BATCH_MERGED':
    case 'STATUS_DURATION_REFRESHED':
    case 'STATUS_BATCH_REPLACED':
    case 'STATUS_REJECTED':
    case 'STATUS_STACK_REMOVED':
    case 'STATUS_BATCH_REMOVED':
    case 'STATUS_DURATION_DECREMENTED':
    case 'STATUS_CLEANSED':
    case 'STATUS_DISPELLED':
    case 'STATUS_REMOVED':
      return `${getUnitName(state, event.ownerUnitId)}${statusChangeName(event.type)}${statusName(event.statusId)}${event.stacks > 0 ? `（${event.stacks} 层）` : ''}`
    case 'BATTLE_CANNOT_CONTINUE':
      return '战斗无法继续：没有可行动单位'
    case 'TRAINING_PAUSED':
      return event.reason === 'MANUAL_PAUSE'
        ? '玩家手动暂停了训练'
        : '所有玩家角色倒下，训练已暂停'
    case 'TRAINING_EXIT_CONFIRMED':
      return '已确认退出训练'
    default:
      return '战斗流程已推进'
  }
}

function skillName(skillId: string, branchId: string | null | undefined): string {
  return displaySkillName(skillId, branchId) ?? '未命名技能'
}

function statusChangeName(type: BattleEvent['type']): string {
  const names: Partial<Record<BattleEvent['type'], string>> = {
    STATUS_ACQUIRED: '获得',
    STATUS_BATCH_MERGED: '叠加了',
    STATUS_DURATION_REFRESHED: '刷新了',
    STATUS_BATCH_REPLACED: '替换为',
    STATUS_REJECTED: '未能获得',
    STATUS_STACK_REMOVED: '失去了一层',
    STATUS_BATCH_REMOVED: '失去了',
    STATUS_DURATION_DECREMENTED: '的持续时间减少：',
    STATUS_CLEANSED: '净化了',
    STATUS_DISPELLED: '被驱散了',
    STATUS_REMOVED: '失去了',
  }
  return names[type] ?? '的状态发生变化：'
}

function statusName(statusId: string): string {
  return displayStatusName(statusId) ?? '未命名状态'
}

function resourceName(resourceType: string): string {
  const names: Record<string, string> = {
    energy: '能量',
    momentum: '势',
    intent: '意',
    magic: '法力',
  }
  return names[resourceType] ?? resourceType
}

function attributeName(attribute: string): string {
  const names: Record<string, string> = {
    attack: '攻击力',
    criticalRate: '暴击率',
    criticalDamage: '暴击伤害',
  }
  return names[attribute] ?? attribute
}

function modifierOperationName(operation: string): string {
  const names: Record<string, string> = {
    applied: '生效',
    durationDecremented: '持续时间减少',
    removed: '结束',
  }
  return names[operation] ?? operation
}
