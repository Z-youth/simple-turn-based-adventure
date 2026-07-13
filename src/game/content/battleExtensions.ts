import type {
  BattleEngineExtensions,
  BattleTransitionResult,
} from '../core/battleEngine'
import type { BattleState, PersonalTurnState } from '../core/contexts'
import type { BattleEvent } from '../core/events'
import { TRAINING_DUMMY_BATTLE_EXTENSIONS } from './bosses/trainingDummy'
import { WANG_DAHAI_BATTLE_EXTENSIONS } from './characters/wangDahai'

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

export function combineBattleEngineExtensions(
  ...extensions: readonly BattleEngineExtensions[]
): BattleEngineExtensions {
  return {
    applyUnitPassiveEffects(state, turn) {
      return runPassiveExtensions(extensions, state, turn)
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
  WANG_DAHAI_BATTLE_EXTENSIONS,
  TRAINING_DUMMY_BATTLE_EXTENSIONS,
)
