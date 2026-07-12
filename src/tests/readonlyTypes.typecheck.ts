import { BattlePhase, PersonalTurnPhase } from '../game/core/enums'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
  TurnQueueEntry,
  TurnSequenceState,
} from '../game/core/contexts'
import type { SequenceStartedEvent } from '../game/core/events'
import type { BattleTransitionSuccess } from '../game/core/battleEngine'
import type { ActionId } from '../game/core/identifiers'

declare const battleState: BattleState
declare const sequence: TurnSequenceState
declare const queueEntry: TurnQueueEntry
declare const turn: PersonalTurnState
declare const action: ActionContext
declare const actionId: ActionId
declare const sequenceStartedEvent: SequenceStartedEvent
declare const transition: BattleTransitionSuccess

// @ts-expect-error Core battle phase is changed only through transitions.
battleState.phase = BattlePhase.AwaitingAction
// @ts-expect-error Sequence cursor is advanced only by the battle engine.
sequence.currentIndex = 1
// @ts-expect-error Sequence completion is controlled by the battle engine.
sequence.completed = true
// @ts-expect-error The current queue cannot be replaced externally.
sequence.queue = []
// @ts-expect-error The current queue cannot be extended externally.
sequence.queue.push(queueEntry)
// @ts-expect-error The current queue cannot be spliced externally.
sequence.queue.splice(0, 1)
// @ts-expect-error Personal turn phase is changed only through lifecycle functions.
turn.phase = PersonalTurnPhase.AwaitingAction
// @ts-expect-error Counted actions are maintained by action completion.
turn.countedActionCount = 2
// @ts-expect-error Started action IDs cannot be replaced externally.
turn.startedActionIds = [actionId]
// @ts-expect-error Started action IDs cannot be mutated externally.
turn.startedActionIds.push(actionId)
// @ts-expect-error Completed action IDs cannot be mutated externally.
turn.completedActionIds.push(actionId)
// @ts-expect-error Action metadata is immutable after confirmation.
action.endsTurn = false
// @ts-expect-error Event payload arrays are immutable.
sequenceStartedEvent.orderedUnitIds.push(queueEntry.unitId)
// @ts-expect-error Result state remains readonly through its domain type.
transition.state.phase = BattlePhase.TurnEnd

export {}
