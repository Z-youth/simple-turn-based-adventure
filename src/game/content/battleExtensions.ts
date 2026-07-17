import type {
  BattleEngineExtensions,
  BattleTransitionResult,
} from '../core/battleEngine'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
} from '../core/contexts'
import type { BattleEvent } from '../core/events'
import { TRAINING_DUMMY_BATTLE_EXTENSIONS } from './bosses/trainingDummy'
import { LI_MUTOU_BATTLE_EXTENSIONS } from './characters/liMutou'
import { WANG_DAHAI_BATTLE_EXTENSIONS } from './characters/wangDahai'
import { YAN_YAN_BATTLE_EXTENSIONS } from './characters/yanYan'
import { LIUNIAN_BATTLE_EXTENSIONS } from './characters/liunian'

function runTurnStartPreSystemExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  turn: PersonalTurnState,
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = extension.applyTurnStartPreSystemEffects
    if (apply === undefined) continue
    const result = apply(currentState, turn)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

function runTurnStartExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  turn: PersonalTurnState,
  select: (extension: BattleEngineExtensions) => (
    ((state: BattleState, turn: PersonalTurnState) => BattleTransitionResult)
    | undefined
  ),
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = select(extension)
    if (apply === undefined) continue
    const currentTurn = currentState.personalTurn
    if (currentTurn === null
      || currentTurn.personalTurnId !== turn.personalTurnId) {
      return { ok: false, state, events: [], reason: 'INVALID_COMBINED_TURN' }
    }
    const result = apply(currentState, currentTurn)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

function runPassiveExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  turn: PersonalTurnState,
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = extension.applyUnitPassiveEffects
    if (apply === undefined) continue
    const currentTurn = currentState.personalTurn
    if (currentTurn === null
      || currentTurn.personalTurnId !== turn.personalTurnId) {
      return {
        ok: false,
        state,
        events: [],
        reason: 'COMBINED_PASSIVE_EXTENSIONS_INVALID_TURN',
      }
    }
    const result = apply(currentState, currentTurn)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

function runTurnStartPostSystemExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  turn: PersonalTurnState,
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = extension.applyTurnStartPostSystemEffects
    if (apply === undefined) continue
    const result = apply(currentState, turn)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

function runAfterActionExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  action: ActionContext,
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = extension.applyAfterActionEffects
    if (apply === undefined) continue
    const result = apply(currentState, action)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

function runTurnEndExtensions(
  extensions: readonly BattleEngineExtensions[],
  state: BattleState,
  turn: PersonalTurnState,
): BattleTransitionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const extension of extensions) {
    const apply = extension.applyUnitTurnEndEffects
    if (apply === undefined) continue
    const currentTurn = currentState.personalTurn
    if (currentTurn === null
      || currentTurn.personalTurnId !== turn.personalTurnId) {
      return {
        ok: false,
        state,
        events: [],
        reason: 'COMBINED_TURN_END_EXTENSIONS_INVALID_TURN',
      }
    }
    const result = apply(currentState, currentTurn)
    if (!result.ok) return { ...result, state, events: [] }
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}

export function combineBattleEngineExtensions(
  ...extensions: readonly BattleEngineExtensions[]
): BattleEngineExtensions {
  return {
    applyUnitBattleStartEffects(state, unitId) {
      let currentState = state
      const events: BattleEvent[] = []
      for (const extension of extensions) {
        const result = extension.applyUnitBattleStartEffects?.(
          currentState,
          unitId,
        )
        if (result === undefined) continue
        if (!result.ok) return { ...result, state, events: [] }
        currentState = result.state
        events.push(...result.events)
      }
      return { ok: true, state: currentState, events }
    },
    applyTurnStartAbsoluteEffects(state, turn) {
      return runTurnStartExtensions(
        extensions,
        state,
        turn,
        (extension) => extension.applyTurnStartAbsoluteEffects,
      )
    },
    resetUnitTurnCounters(state, turn) {
      return runTurnStartExtensions(
        extensions,
        state,
        turn,
        (extension) => extension.resetUnitTurnCounters,
      )
    },
    applySequenceStartEffects(state, sequence) {
      let currentState = state
      const events: BattleEvent[] = []
      for (const extension of extensions) {
        const result = extension.applySequenceStartEffects?.(
          currentState,
          sequence,
        )
        if (result === undefined) continue
        if (!result.ok) return { ...result, state, events: [] }
        currentState = result.state
        events.push(...result.events)
      }
      return { ok: true, state: currentState, events }
    },
    applyTurnStartPreSystemEffects(state, turn) {
      return runTurnStartPreSystemExtensions(extensions, state, turn)
    },
    applyTurnStartPostSystemEffects(state, turn) {
      return runTurnStartPostSystemExtensions(extensions, state, turn)
    },
    applyTurnStartForcedChoices(state, turn) {
      return runTurnStartExtensions(
        extensions,
        state,
        turn,
        (extension) => extension.applyTurnStartForcedChoices,
      )
    },
    applyUnitPassiveEffects(state, turn) {
      return runPassiveExtensions(extensions, state, turn)
    },
    applyAfterActionEffects(state, action) {
      return runAfterActionExtensions(extensions, state, action)
    },
    applyUnitTurnEndEffects(state, turn) {
      return runTurnEndExtensions(extensions, state, turn)
    },
    runAutomaticAction(state) {
      for (const extension of extensions) {
        const result = extension.runAutomaticAction?.(state)
        if (result !== undefined && result !== null) return result
      }
      return null
    },
  }
}

export const GAME_CONTENT_BATTLE_EXTENSIONS = combineBattleEngineExtensions(
  LIUNIAN_BATTLE_EXTENSIONS,
  WANG_DAHAI_BATTLE_EXTENSIONS,
  LI_MUTOU_BATTLE_EXTENSIONS,
  YAN_YAN_BATTLE_EXTENSIONS,
  TRAINING_DUMMY_BATTLE_EXTENSIONS,
)
