import { useRef, useState } from 'react'
import './App.css'
import {
  endWangDahaiTurn,
  executeWangDahaiAction,
  formatBattleEvent,
  getActionUnavailableReason,
  getTide,
  startUiBattle,
} from './game/ui/battleUiAdapter'
import type { WangDahaiAction } from './game/ui/battleUiAdapter'
import {
  TRAINING_DUMMY_UNIT_ID,
} from './game/content/bosses/trainingDummy'
import {
  WANG_DAHAI_UNIT_ID,
} from './game/content/characters/wangDahai'
import type { BattleState } from './game/core/contexts'
import type { UnitState } from './game/core/units'

const PHASE_NAMES: Record<string, string> = {
  setup: '准备中',
  sequenceStart: '轮次开始',
  turnStart: '回合开始',
  awaitingAction: '等待行动',
  resolvingAction: '行动结算',
  turnEnd: '回合结束',
  unableToContinue: '无法继续',
  paused: '暂停',
  finished: '已结束',
}

const PERSONAL_TURN_PHASE_NAMES: Record<string, string> = {
  startingDelayedEffects: '延迟效果',
  startingSystemRules: '系统规则',
  startingUnitPassives: '单位被动',
  startingStatusEffects: '状态效果',
  awaitingAction: '等待行动',
  resolvingAction: '行动结算',
  ending: '准备结束',
  endingTriggeredEffects: '触发效果',
  endingUnitSpecificEffects: '单位回合结束效果',
  endingStatusEffects: '状态效果',
  endingSpecialVariables: '特殊变量',
  endingStatusDurations: '状态持续时间',
  endingTemporaryModifiers: '临时属性',
  ended: '已结束',
}

interface ActionButtonProps {
  readonly label: string
  readonly detail: string
  readonly reason: string | null
  readonly onClick: () => void
  readonly tone?: 'primary' | 'secondary'
}

function ActionButton({
  label,
  detail,
  reason,
  onClick,
  tone = 'primary',
}: ActionButtonProps) {
  return (
    <div className="action-option">
      <button
        className={`action-button action-button--${tone}`}
        type="button"
        disabled={reason !== null}
        onClick={onClick}
      >
        <strong>{label}</strong>
        <span>{detail}</span>
      </button>
      <small className={reason === null ? 'available' : 'unavailable'}>
        {reason ?? '可使用'}
      </small>
    </div>
  )
}

function Stat({ label, value }: { readonly label: string, readonly value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function UnitCard({ unit, player }: { readonly unit: UnitState, readonly player: boolean }) {
  const health = unit.hasInfiniteHealth
    ? '∞'
    : `${unit.currentHealth} / ${unit.maximumHealth}`
  return (
    <article className={`unit-card ${player ? 'unit-card--player' : 'unit-card--enemy'}`}>
      <div className="unit-heading">
        <div>
          <span className="unit-side">{player ? '我方' : '敌方'}</span>
          <h2>{unit.name}</h2>
        </div>
        <span className={`life-state ${unit.alive ? '' : 'life-state--down'}`}>
          {unit.alive ? '存活' : '倒下'}
        </span>
      </div>
      <div className="health-track" aria-label={`生命 ${health}`}>
        <span
          style={{
            width: unit.hasInfiniteHealth
              ? '100%'
              : `${Math.max(0, unit.currentHealth / unit.maximumHealth * 100)}%`,
          }}
        />
      </div>
      <div className="stats-grid">
        <Stat label="生命" value={health} />
        <Stat label="护盾" value={unit.shield} />
        <Stat label="能量" value={unit.energy} />
        <Stat label="势" value={unit.momentum} />
        <Stat label="势压" value={unit.momentumPressure} />
        <Stat label="海潮" value={player ? getTide(unit) : 0} />
      </div>
    </article>
  )
}

function App() {
  const [battleState, setBattleState] = useState<BattleState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actionSerial = useRef(0)

  const startOrReset = () => {
    actionSerial.current = 0
    const result = startUiBattle(Date.now())
    setBattleState(result.state)
    setError(result.ok ? null : result.reason ?? '战斗启动失败')
  }

  const performAction = (action: WangDahaiAction) => {
    if (battleState === null) return
    actionSerial.current += 1
    const result = executeWangDahaiAction(
      battleState,
      action,
      actionSerial.current,
    )
    setBattleState(result.state)
    setError(result.ok ? null : result.reason ?? '行动失败')
  }

  const endTurn = () => {
    if (battleState === null) return
    const result = endWangDahaiTurn(battleState)
    setBattleState(result.state)
    setError(result.ok ? null : result.reason ?? '结束回合失败')
  }

  const wangDahai = battleState?.units.find((unit) => (
    unit.id === WANG_DAHAI_UNIT_ID
  ))
  const trainingDummy = battleState?.units.find((unit) => (
    unit.id === TRAINING_DUMMY_UNIT_ID
  ))
  const currentUnit = battleState?.personalTurn === null
    ? null
    : battleState?.units.find((unit) => (
        unit.id === battleState.personalTurn?.unitId
      )) ?? null
  const recentEvents = battleState?.events.slice(-18).reverse() ?? []

  return (
    <main className="battle-app">
      <header className="topbar">
        <div>
          <p className="eyebrow">简单的回合制大冒险 · 战斗测试</p>
          <h1>王大海 vs 训练假人</h1>
        </div>
        <button className="reset-button" type="button" onClick={startOrReset}>
          {battleState === null ? '开始战斗' : '重置战斗'}
        </button>
      </header>

      <section className="battle-status" aria-live="polite">
        <div>
          <span>当前行动者</span>
          <strong>{currentUnit?.name ?? '尚未开始'}</strong>
        </div>
        <div>
          <span>战斗阶段</span>
          <strong>{battleState === null ? '未开始' : PHASE_NAMES[battleState.phase] ?? battleState.phase}</strong>
        </div>
        <div>
          <span>回合阶段</span>
          <strong>
            {battleState?.personalTurn === null || battleState?.personalTurn === undefined
              ? '—'
              : PERSONAL_TURN_PHASE_NAMES[battleState.personalTurn.phase]
                ?? battleState.personalTurn.phase}
          </strong>
        </div>
        <div>
          <span>轮次</span>
          <strong>{battleState?.turnSequence?.sequenceNumber ?? '—'}</strong>
        </div>
      </section>

      <section className="combatants" aria-label="战斗双方">
        {wangDahai === undefined
          ? <div className="unit-placeholder">开始战斗后显示王大海状态</div>
          : <UnitCard unit={wangDahai} player />}
        <div className="versus">VS</div>
        {trainingDummy === undefined
          ? <div className="unit-placeholder">开始战斗后显示训练假人状态</div>
          : <UnitCard unit={trainingDummy} player={false} />}
      </section>

      <section className="lower-grid">
        <div className="panel actions-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">王大海</p>
              <h2>行动</h2>
            </div>
            <span>技能规则由 BattleEngine 结算</span>
          </div>
          <div className="action-grid">
            <ActionButton
              label="新潮式"
              detail="无消耗 · 单体伤害 · 结束回合"
              reason={getActionUnavailableReason(battleState, 'newTide')}
              onClick={() => performAction('newTide')}
            />
            <ActionButton
              label="叠浪式"
              detail="1 能量 · 连续行动 · 叠加势"
              reason={getActionUnavailableReason(battleState, 'stackingWave')}
              onClick={() => performAction('stackingWave')}
            />
            <ActionButton
              label="月海潮生"
              detail="5 能量 · 获得暴击强化与 2 层海潮"
              reason={getActionUnavailableReason(battleState, 'moonlitTide')}
              onClick={() => performAction('moonlitTide')}
            />
            <ActionButton
              label="主动结束回合"
              detail="执行回合结束效果并交给训练假人行动"
              reason={getActionUnavailableReason(battleState, 'endTurn')}
              onClick={endTurn}
              tone="secondary"
            />
          </div>
          {error !== null && (
            <div className="error-message" role="alert">
              <strong>操作失败</strong>
              <span>{error}</span>
            </div>
          )}
        </div>

        <aside className="panel event-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">战斗记录</p>
              <h2>最近事件</h2>
            </div>
            <span>最新在上</span>
          </div>
          {recentEvents.length === 0
            ? <p className="empty-events">战斗开始后，这里会显示引擎事件。</p>
            : (
                <ol className="event-list">
                  {recentEvents.map((event, index) => (
                    <li key={`${battleState?.events.length ?? 0}-${index}`}>
                      {battleState === null ? event.type : formatBattleEvent(battleState, event)}
                    </li>
                  ))}
                </ol>
              )}
        </aside>
      </section>
    </main>
  )
}

export default App
