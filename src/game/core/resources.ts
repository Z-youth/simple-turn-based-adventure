import type { BattleState } from './contexts'
import type { ResourceTransactionId, UnitId } from './identifiers'
import type { UnitState } from './units'
import type { BattleEvent } from './events'
import { roundIntegerResult } from './rounding'
import {
  findActiveResourceReductionProtection,
  validateSpecialCounters,
} from './specialCounters'

export const ResourceType = Object.freeze({
  Energy: 'energy',
  Momentum: 'momentum',
  MomentumPressure: 'momentumPressure',
  Intent: 'intent',
  Magic: 'magic',
  Flow: 'flow',
} as const)

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType]

const CANONICAL_RESOURCE_TYPE_ORDER: readonly ResourceType[] = Object.freeze([
  ResourceType.Energy,
  ResourceType.Momentum,
  ResourceType.MomentumPressure,
  ResourceType.Intent,
  ResourceType.Magic,
  ResourceType.Flow,
])

export const RESOURCE_TYPE_ORDER: readonly ResourceType[] = Object.freeze([
  ...CANONICAL_RESOURCE_TYPE_ORDER,
])

export interface ResourceConfig {
  readonly resourceType: ResourceType
  readonly minimum: number
  readonly maximum: number | null
  readonly allowGain: boolean
  readonly allowSpend: boolean
  readonly systemDerived: boolean
}

export interface ResourceConfiguration {
  readonly resources: readonly ResourceConfig[]
}

export interface EnergyConfigurationOptions {
  readonly minimum?: number
}

export type ResourceErrorCode =
  | 'RESOURCE_OWNER_NOT_FOUND'
  | 'RESOURCE_OWNER_DEAD'
  | 'RESOURCE_NOT_SUPPORTED'
  | 'RESOURCE_OPERATION_NOT_ALLOWED'
  | 'INVALID_RESOURCE_AMOUNT'
  | 'INVALID_RESOURCE_CONFIGURATION'
  | 'RESOURCE_VALUE_OUT_OF_RANGE'
  | 'INSUFFICIENT_RESOURCE'
  | 'INVALID_SPECIAL_COUNTER_STATE'
  | 'INVALID_RESOURCE_REDUCTION_PROTECTION'

export interface ResourceContextIds {
  readonly actionId: import('./identifiers').ActionId | null
  readonly personalTurnId: import('./identifiers').PersonalTurnId | null
  readonly sequenceId: import('./identifiers').TurnSequenceId | null
  readonly skillExecutionId: import('./identifiers').SkillExecutionId | null
  readonly resourceTransactionId: ResourceTransactionId | null
}

export interface ResourceChangeRequest extends ResourceContextIds {
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly amount: number
  readonly reason: string
  readonly sourceId: string | null
  readonly sourceUnitId?: UnitId | null
  readonly effectId?: string | null
}

export interface ResourceSetRequest extends ResourceContextIds {
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly value: number
  readonly reason: string
  readonly sourceId: string | null
  readonly sourceUnitId?: UnitId | null
  readonly effectId?: string | null
}

export interface ResourceCost {
  readonly resourceType: ResourceType
  readonly amount: number
}

export interface ResourceChangeSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface ResourceChangeFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: ResourceErrorCode
}

export type ResourceChangeResult = ResourceChangeSuccess | ResourceChangeFailure

export interface ResourceFormulaSuccess {
  readonly ok: true
  readonly value: number
}

export interface ResourceFormulaFailure {
  readonly ok: false
  readonly reason: 'INVALID_RESOURCE_AMOUNT' | 'RESOURCE_VALUE_OUT_OF_RANGE'
}

export type ResourceFormulaResult = ResourceFormulaSuccess | ResourceFormulaFailure

function freezeResourceConfiguration(
  resources: readonly ResourceConfig[],
): ResourceConfiguration {
  const frozenResources = Object.freeze(resources.map((config) => (
    Object.freeze({ ...config })
  )))
  return Object.freeze({ resources: frozenResources })
}

const DEFAULT_RESOURCE_CONFIGURATION = freezeResourceConfiguration([
  {
    resourceType: ResourceType.Energy,
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: null,
    allowGain: true,
    allowSpend: true,
    systemDerived: false,
  },
  {
    resourceType: ResourceType.Momentum,
    minimum: 0,
    maximum: null,
    allowGain: true,
    allowSpend: true,
    systemDerived: false,
  },
  {
    resourceType: ResourceType.MomentumPressure,
    minimum: 0,
    maximum: null,
    allowGain: false,
    allowSpend: false,
    systemDerived: true,
  },
  {
    resourceType: ResourceType.Intent,
    minimum: 0,
    maximum: null,
    allowGain: true,
    allowSpend: true,
    systemDerived: false,
  },
  {
    resourceType: ResourceType.Magic,
    minimum: 0,
    maximum: null,
    allowGain: true,
    allowSpend: true,
    systemDerived: false,
  },
  {
    resourceType: ResourceType.Flow,
    minimum: 0,
    maximum: null,
    allowGain: true,
    allowSpend: true,
    systemDerived: false,
  },
])

export function resolveResourceFormulaValue(value: number): ResourceFormulaResult {
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'INVALID_RESOURCE_AMOUNT' }
  }
  const rounded = roundIntegerResult(value)
  return Number.isSafeInteger(rounded)
    ? { ok: true, value: rounded }
    : { ok: false, reason: 'RESOURCE_VALUE_OUT_OF_RANGE' }
}

export function validateResourceConfiguration(
  configuration: ResourceConfiguration,
): ResourceErrorCode | null {
  if (configuration === null
    || typeof configuration !== 'object'
    || !Array.isArray(configuration.resources)
    || configuration.resources.length !== CANONICAL_RESOURCE_TYPE_ORDER.length) {
    return 'INVALID_RESOURCE_CONFIGURATION'
  }
  const standard = createDefaultResourceConfiguration()
  for (const [index, expected] of standard.resources.entries()) {
    const config = configuration.resources[index]
    if (config === undefined
      || config === null
      || typeof config !== 'object'
      || config.resourceType !== expected.resourceType) {
      return 'INVALID_RESOURCE_CONFIGURATION'
    }
    const minimumIsValid = expected.resourceType === ResourceType.Energy
      ? Number.isSafeInteger(config.minimum) && config.minimum <= 0
      : config.minimum === expected.minimum
    if (!minimumIsValid
      || config.maximum !== expected.maximum
      || config.allowGain !== expected.allowGain
      || config.allowSpend !== expected.allowSpend
      || config.systemDerived !== expected.systemDerived) {
      return 'INVALID_RESOURCE_CONFIGURATION'
    }
  }
  return null
}

export function createDefaultResourceConfiguration(
): ResourceConfiguration {
  return DEFAULT_RESOURCE_CONFIGURATION
}

export function createResourceConfiguration(
  energy: EnergyConfigurationOptions = {},
): ResourceConfiguration {
  const energyMinimum = energy.minimum ?? Number.MIN_SAFE_INTEGER
  if (!Number.isSafeInteger(energyMinimum) || energyMinimum > 0) {
    throw new RangeError('INVALID_RESOURCE_CONFIGURATION')
  }
  const defaults = createDefaultResourceConfiguration()
  const configuration: ResourceConfiguration = energyMinimum === Number.MIN_SAFE_INTEGER
    ? defaults
    : freezeResourceConfiguration(
        defaults.resources.map((config) => (
          config.resourceType === ResourceType.Energy
            ? { ...config, minimum: energyMinimum }
            : config
        )),
      )
  if (validateResourceConfiguration(configuration) !== null) {
    throw new RangeError('INVALID_RESOURCE_CONFIGURATION')
  }
  return configuration
}

export function getResourceConfig(
  configuration: ResourceConfiguration,
  resourceType: ResourceType,
): ResourceConfig | undefined {
  if (validateResourceConfiguration(configuration) !== null) return undefined
  return configuration.resources.find(
    (config) => config.resourceType === resourceType,
  )
}

export function unitResourcesMatchConfiguration(
  unit: UnitState,
  configuration: ResourceConfiguration,
): boolean {
  if (validateResourceConfiguration(configuration) !== null) return false
  if (validateUnitResourceReductionProtections(unit) !== null) return false
  return CANONICAL_RESOURCE_TYPE_ORDER.every((resourceType) => {
    const config = getResourceConfig(configuration, resourceType)
    const value = readUnitResource(unit, resourceType)
    return config !== undefined
      && Number.isSafeInteger(value)
      && value >= config.minimum
      && (config.maximum === null || value <= config.maximum)
  })
}

export function validateUnitResourceReductionProtections(
  unit: UnitState,
): ResourceErrorCode | null {
  if (validateSpecialCounters(unit) !== null) {
    return 'INVALID_SPECIAL_COUNTER_STATE'
  }
  if (!Array.isArray(unit.resourceReductionProtections)) {
    return 'INVALID_RESOURCE_REDUCTION_PROTECTION'
  }
  const keys: string[] = []
  for (const protection of unit.resourceReductionProtections) {
    if (
      protection === null
      || typeof protection !== 'object'
      || !CANONICAL_RESOURCE_TYPE_ORDER.includes(protection.resourceType)
      || typeof protection.counterId !== 'string'
      || protection.counterId.length === 0
      || !Number.isSafeInteger(protection.minimumCounterValue)
      || protection.minimumCounterValue <= 0
    ) return 'INVALID_RESOURCE_REDUCTION_PROTECTION'
    keys.push(`${protection.resourceType}:${protection.counterId}`)
  }
  return new Set(keys).size === keys.length
    ? null
    : 'INVALID_RESOURCE_REDUCTION_PROTECTION'
}

export function readUnitResource(
  unit: UnitState,
  resourceType: ResourceType,
): number {
  const contributed = (unit.resourceCounterContributions ?? []).reduce(
    (total, contribution) => contribution.resourceType === resourceType
      ? total + (unit.specialCounters.find((counter) => (
          counter.counterId === contribution.counterId
        ))?.value ?? 0)
      : total,
    0,
  )
  switch (resourceType) {
    case ResourceType.Energy:
      return unit.energy + contributed
    case ResourceType.Momentum:
      return unit.momentum + contributed
    case ResourceType.MomentumPressure:
      return unit.momentumPressure
    case ResourceType.Intent:
      return unit.intent
    case ResourceType.Magic:
      return unit.magic
    case ResourceType.Flow:
      return (unit.flow ?? 0) + contributed
  }
}

function replaceUnitResource(
  unit: UnitState,
  resourceType: ResourceType,
  value: number,
): UnitState {
  switch (resourceType) {
    case ResourceType.Energy:
      return { ...unit, energy: value }
    case ResourceType.Momentum:
      return { ...unit, momentum: value }
    case ResourceType.MomentumPressure:
      return { ...unit, momentumPressure: value }
    case ResourceType.Intent:
      return { ...unit, intent: value }
    case ResourceType.Magic:
      return { ...unit, magic: value }
    case ResourceType.Flow:
      return { ...unit, flow: value }
  }
}

function replaceUnitResourceWithPriorities(
  unit: UnitState,
  resourceType: ResourceType,
  before: number,
  after: number,
): UnitState {
  if (after >= before) {
    const baseValue = resourceType === ResourceType.Momentum
      ? unit.momentum
      : resourceType === ResourceType.Flow
        ? unit.flow ?? 0
        : before
    return replaceUnitResource(unit, resourceType, baseValue + after - before)
  }
  let remainingReduction = before - after
  let counters = unit.specialCounters
  const contributions = (unit.resourceCounterContributions ?? [])
    .filter((contribution) => contribution.resourceType === resourceType)
    .slice()
    .sort((left, right) => left.reductionPriority - right.reductionPriority)
  for (const contribution of contributions) {
    if (remainingReduction === 0) break
    const counter = counters.find((candidate) => (
      candidate.counterId === contribution.counterId
    ))
    if (counter === undefined || counter.value === 0) continue
    const reduction = Math.min(counter.value, remainingReduction)
    counters = counters.map((candidate) => candidate.counterId === counter.counterId
      ? { ...candidate, value: candidate.value - reduction }
      : candidate)
    remainingReduction -= reduction
  }
  const baseBefore = resourceType === ResourceType.Momentum
    ? unit.momentum
    : resourceType === ResourceType.Flow
      ? unit.flow ?? 0
      : before
  return replaceUnitResource(
    { ...unit, specialCounters: counters },
    resourceType,
    baseBefore - remainingReduction,
  )
}

function setUnitResourceValue(
  unit: UnitState,
  resourceType: ResourceType,
  value: number,
): UnitState {
  const counterIds = new Set((unit.resourceCounterContributions ?? [])
    .filter((contribution) => contribution.resourceType === resourceType)
    .map((contribution) => contribution.counterId))
  const cleared = counterIds.size === 0
    ? unit
    : {
        ...unit,
        specialCounters: unit.specialCounters.map((counter) => (
          counterIds.has(counter.counterId) ? { ...counter, value: 0 } : counter
        )),
      }
  return replaceUnitResource(cleared, resourceType, value)
}

function failure(
  state: BattleState,
  reason: ResourceErrorCode,
): ResourceChangeFailure {
  return { ok: false, state, events: [], reason }
}

function validateAmount(amount: number): ResourceErrorCode | null {
  return Number.isSafeInteger(amount) && amount > 0
    ? null
    : 'INVALID_RESOURCE_AMOUNT'
}

function getReservedResourceAmount(
  state: BattleState,
  request: ResourceChangeRequest,
): number {
  const payment = state.completedResourcePayment
  if (
    payment === null
    || payment.payerUnitId !== request.unitId
    || payment.resourceTransactionId === request.resourceTransactionId
  ) return 0
  return payment.reservedCosts.find((cost) => (
    cost.resourceType === request.resourceType
  ))?.amount ?? 0
}

function changeResource(
  state: BattleState,
  request: ResourceChangeRequest,
  kind: 'gain' | 'lose' | 'spend',
): ResourceChangeResult {
  const invalidConfiguration = validateResourceConfiguration(
    state.resourceConfiguration,
  )
  if (invalidConfiguration !== null) return failure(state, invalidConfiguration)
  const amountError = validateAmount(request.amount)
  if (amountError !== null) return failure(state, amountError)
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'RESOURCE_OWNER_NOT_FOUND')
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return failure(state, 'RESOURCE_OWNER_DEAD')
  }
  const invalidProtection = validateUnitResourceReductionProtections(unit)
  if (invalidProtection !== null) return failure(state, invalidProtection)
  const config = getResourceConfig(
    state.resourceConfiguration,
    request.resourceType,
  )
  if (config === undefined) return failure(state, 'RESOURCE_NOT_SUPPORTED')
  if ((kind === 'gain' && !config.allowGain)
    || (kind !== 'gain' && !config.allowSpend)) {
    return failure(state, 'RESOURCE_OPERATION_NOT_ALLOWED')
  }
  const before = readUnitResource(unit, request.resourceType)
  if (!Number.isSafeInteger(before)
    || before < config.minimum
    || (config.maximum !== null && before > config.maximum)) {
    return failure(state, 'RESOURCE_VALUE_OUT_OF_RANGE')
  }
  if (kind !== 'gain') {
    const protection = findActiveResourceReductionProtection(
      unit,
      request.resourceType,
    )
    if (protection !== null) {
      const event: BattleEvent = {
        type: 'RESOURCE_REDUCTION_PREVENTED',
        unitId: request.unitId,
        resourceType: request.resourceType,
        attemptedAmount: request.amount,
        protectionCounterId: protection.counterId,
        reason: request.reason,
        sourceId: request.sourceId,
        sourceUnitId: request.sourceUnitId ?? null,
        effectId: request.effectId ?? request.reason,
        actionId: request.actionId,
        personalTurnId: request.personalTurnId,
        sequenceId: request.sequenceId,
        skillExecutionId: request.skillExecutionId,
        resourceTransactionId: request.resourceTransactionId,
      }
      return {
        ok: true,
        state: { ...state, events: [...state.events, event] },
        events: [event],
      }
    }
  }
  const reservedAmount = kind !== 'gain'
    ? getReservedResourceAmount(state, request)
    : 0
  const minimum = kind === 'spend' && request.resourceType === ResourceType.Energy
    ? Math.max(0, config.minimum)
    : config.minimum
  if (kind !== 'gain' && before - reservedAmount - request.amount < minimum) {
    return failure(state, 'INSUFFICIENT_RESOURCE')
  }
  const rawAfter = kind === 'gain'
    ? before + request.amount
    : before - request.amount
  if (!Number.isSafeInteger(rawAfter)) {
    return failure(state, kind !== 'gain'
      ? 'INSUFFICIENT_RESOURCE'
      : 'RESOURCE_VALUE_OUT_OF_RANGE')
  }
  if (rawAfter < config.minimum) {
    return failure(state, 'INSUFFICIENT_RESOURCE')
  }
  const after = config.maximum === null
    ? rawAfter
    : Math.min(rawAfter, config.maximum)
  const actualAmount = Math.abs(after - before)
  if (actualAmount === 0) {
    return { ok: true, state, events: [] }
  }
  const replacement = replaceUnitResourceWithPriorities(
    unit,
    request.resourceType,
    before,
    after,
  )
  const event: BattleEvent = {
    type: kind === 'gain'
      ? 'RESOURCE_GAINED'
      : kind === 'lose'
        ? 'RESOURCE_LOST'
        : 'RESOURCE_SPENT',
    unitId: request.unitId,
    resourceType: request.resourceType,
    amount: actualAmount,
    before,
    after,
    reason: request.reason,
    sourceId: request.sourceId,
    sourceUnitId: request.sourceUnitId ?? null,
    effectId: request.effectId ?? request.reason,
    actionId: request.actionId,
    personalTurnId: request.personalTurnId,
    sequenceId: request.sequenceId,
    skillExecutionId: request.skillExecutionId,
    resourceTransactionId: request.resourceTransactionId,
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => (
        candidate.id === replacement.id ? replacement : candidate
      )),
      events: [...state.events, event],
    },
    events: [event],
  }
}

export function gainResource(
  state: BattleState,
  request: ResourceChangeRequest,
): ResourceChangeResult {
  return changeResource(state, request, 'gain')
}

export function spendResource(
  state: BattleState,
  request: ResourceChangeRequest,
): ResourceChangeResult {
  return changeResource(state, request, 'spend')
}

export function loseResource(
  state: BattleState,
  request: ResourceChangeRequest,
): ResourceChangeResult {
  return changeResource(state, request, 'lose')
}

export function setResource(
  state: BattleState,
  request: ResourceSetRequest,
): ResourceChangeResult {
  const invalidConfiguration = validateResourceConfiguration(
    state.resourceConfiguration,
  )
  if (invalidConfiguration !== null) return failure(state, invalidConfiguration)
  if (!Number.isSafeInteger(request.value)) {
    return failure(state, 'INVALID_RESOURCE_AMOUNT')
  }
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'RESOURCE_OWNER_NOT_FOUND')
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return failure(state, 'RESOURCE_OWNER_DEAD')
  }
  const invalidProtection = validateUnitResourceReductionProtections(unit)
  if (invalidProtection !== null) return failure(state, invalidProtection)
  const config = getResourceConfig(state.resourceConfiguration, request.resourceType)
  if (config === undefined) return failure(state, 'RESOURCE_NOT_SUPPORTED')
  if (config.systemDerived) return failure(state, 'RESOURCE_OPERATION_NOT_ALLOWED')
  if (request.value < config.minimum
    || (config.maximum !== null && request.value > config.maximum)) {
    return failure(state, 'RESOURCE_VALUE_OUT_OF_RANGE')
  }
  const before = readUnitResource(unit, request.resourceType)
  if (!Number.isSafeInteger(before)
    || before < config.minimum
    || (config.maximum !== null && before > config.maximum)) {
    return failure(state, 'RESOURCE_VALUE_OUT_OF_RANGE')
  }
  if (before === request.value) return { ok: true, state, events: [] }
  const replacement = setUnitResourceValue(
    unit,
    request.resourceType,
    request.value,
  )
  const event: BattleEvent = {
    type: 'RESOURCE_SET',
    unitId: unit.id,
    resourceType: request.resourceType,
    before,
    after: request.value,
    reason: request.reason,
    sourceId: request.sourceId,
    sourceUnitId: request.sourceUnitId ?? null,
    effectId: request.effectId ?? request.reason,
    actionId: request.actionId,
    personalTurnId: request.personalTurnId,
    sequenceId: request.sequenceId,
    skillExecutionId: request.skillExecutionId,
    resourceTransactionId: request.resourceTransactionId,
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => (
        candidate.id === unit.id ? replacement : candidate
      )),
      events: [...state.events, event],
    },
    events: [event],
  }
}
