import { GAME_CONTENT_BATTLE_EXTENSIONS } from '../content/battleExtensions'
import {
  createTrainingDummy,
  TRAINING_DUMMY_UNIT_ID,
} from '../content/bosses/trainingDummy'
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
  requestPlayerEndTurn,
  startBattleSequence,
} from '../core/battleEngine'
import { EndTurnConfirmation } from '../core/commands'
import type { BattleState } from '../core/contexts'
import { BattlePhase, PersonalTurnPhase } from '../core/enums'
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
import { isUnitAlive } from '../core/unitQueries'
import type { UnitState } from '../core/units'

export type WangDahaiAction = 'newTide' | 'stackingWave' | 'moonlitTide'

export interface UiBattleResult {
  readonly ok: boolean
  readonly state: BattleState
  readonly reason?: string
}

function createInitialState(seed: number): BattleState {
  return {
    phase: BattlePhase.Setup,
    units: [createWangDahai(), createTrainingDummy()],
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

export function startUiBattle(seed: number): UiBattleResult {
  const initialState = createInitialState(seed)
  const result = startBattleSequence(
    initialState,
    GAME_CONTENT_BATTLE_EXTENSIONS,
  )
  return result.ok
    ? { ok: true, state: result.state }
    : { ok: false, state: result.state, reason: result.reason }
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

export function getUnitName(state: BattleState, unitId: UnitId): string {
  return state.units.find((unit) => unit.id === unitId)?.name ?? String(unitId)
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
      return `${getUnitName(state, event.casterId)}发动技能`
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
    case 'BATTLE_CANNOT_CONTINUE':
      return '战斗无法继续：没有可行动单位'
    default:
      return event.type
        .replaceAll('_', ' ')
        .toLowerCase()
  }
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
