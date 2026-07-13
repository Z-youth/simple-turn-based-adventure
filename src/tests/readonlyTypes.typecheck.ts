import { BattlePhase, PersonalTurnPhase } from '../game/core/enums'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
  TurnQueueEntry,
  TurnSequenceState,
  AttackContext,
  DamageEvent,
} from '../game/core/contexts'
import type { SequenceStartedEvent } from '../game/core/events'
import type { BattleTransitionSuccess } from '../game/core/battleEngine'
import type { ActionId, AttackId } from '../game/core/identifiers'
import type { StatusBatch } from '../game/core/statuses'
import type { UnitState } from '../game/core/units'
import type { RandomState } from '../game/core/rng'
// @ts-expect-error Low-level status mutation is intentionally not public.
import { addStatusBatch } from '../game/core/statusEngine'
// @ts-expect-error Unit-returning shield mutation is intentionally not public.
import { applyShieldedDamage } from '../game/core/shields'

declare const battleState: BattleState
declare const sequence: TurnSequenceState
declare const queueEntry: TurnQueueEntry
declare const turn: PersonalTurnState
declare const action: ActionContext
declare const actionId: ActionId
declare const otherAttackId: AttackId
declare const sequenceStartedEvent: SequenceStartedEvent
declare const transition: BattleTransitionSuccess
declare const unit: UnitState
declare const statusBatch: StatusBatch
declare const rngState: RandomState
declare const attackContext: AttackContext
declare const damageEvent: DamageEvent

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
// @ts-expect-error Health changes only through damage resolution.
unit.currentHealth = 1
// @ts-expect-error Shield changes only through shield resolution.
unit.shield = 1
// @ts-expect-error Status batches cannot be appended externally.
battleState.statusBatches.push(statusBatch)
// @ts-expect-error Status acquisition history cannot be extended externally.
battleState.statusAcquisitionOrders.push(1)
// @ts-expect-error Status batch duration changes only through the status engine.
statusBatch.remainingOwnerTurns = 1
// @ts-expect-error Status stacks change only through the status engine.
statusBatch.stacks = 2
// @ts-expect-error Battle events cannot be appended externally.
battleState.events.push(sequenceStartedEvent)
// @ts-expect-error Active skill is controlled by skill resolution.
battleState.activeSkill = null
// @ts-expect-error Per-target trigger locks cannot be appended externally.
battleState.activeSkill?.perTargetTriggerLocks.push({
  lockId: '' as import('../game/core/identifiers').TriggerLockId,
  triggeredTargetIds: [],
})
// @ts-expect-error Skill completion evidence is controlled by resolution.
battleState.completedSkillResolution = null
// @ts-expect-error Resolution ID registries cannot be extended externally.
battleState.resolutionIds.attackIds.push(otherAttackId)
// @ts-expect-error RNG cursor changes only through pure random transitions.
rngState.cursor = 1
// @ts-expect-error Attack context identity is immutable.
attackContext.attackId = otherAttackId
// @ts-expect-error Damage event values are immutable.
damageEvent.resolvedValue = 0

void addStatusBatch
void applyShieldedDamage

export {}
