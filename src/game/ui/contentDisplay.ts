import {
  LI_MUTOU_AUTUMN_BRANCH_ID,
  LI_MUTOU_FIRST_SKILL_ID,
  LI_MUTOU_SECOND_SKILL_ID,
  LI_MUTOU_THIRD_SKILL_ID,
} from '../content/characters/liMutou'
import {
  WANG_DAHAI_FIRST_SKILL_ID,
  WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID,
  WANG_DAHAI_STACKING_WAVE_BRANCH_ID,
  WANG_DAHAI_THIRD_SKILL_ID,
} from '../content/characters/wangDahai'
import {
  YAN_YAN_BAIYUE_SKILL_ID,
  YAN_YAN_FIRST_SKILL_ID,
  YAN_YAN_PEAKS_SKILL_ID,
  YAN_YAN_RIDGES_SKILL_ID,
} from '../content/characters/yanYan'
import { TRAINING_DUMMY_REVENGE_SKILL_ID } from '../content/bosses/trainingDummy'

const skillNames: Record<string, string> = {
  [WANG_DAHAI_FIRST_SKILL_ID]: '新潮式',
  [WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID]: '万江归海',
  [WANG_DAHAI_THIRD_SKILL_ID]: '月海潮生',
  [YAN_YAN_FIRST_SKILL_ID]: '镇山岳',
  [YAN_YAN_PEAKS_SKILL_ID]: '峰峦起',
  [YAN_YAN_RIDGES_SKILL_ID]: '层峦叠嶂',
  [YAN_YAN_BAIYUE_SKILL_ID]: '拜岳凿天',
  [LI_MUTOU_FIRST_SKILL_ID]: '一叶春',
  [LI_MUTOU_SECOND_SKILL_ID]: '刀域·无边木叶',
  [LI_MUTOU_THIRD_SKILL_ID]: '千山落木，敝叶遮天',
  [TRAINING_DUMMY_REVENGE_SKILL_ID]: '报复',
}

const effectNames: Record<string, string> = {
  trainingDummySteadfast: '坚守',
  trainingDummyMomentum: '气势',
  momentumPressure: '势压',
  yanYanGuardStance: '守势',
  yanYanImmovableMountainTurnEnd: '不动如山',
  yanYanImmovableMountainAllyShield: '不动如山',
  yanYanBaiyueRestore: '拜岳凿天',
  wangDahaiTidalBladeMomentum: '海潮刀势',
  wangDahaiRisingMomentum: '起势',
  'character:wang-dahai': '起势',
  wangDahaiMyriadRivers: '万江归海',
  liMutouMicroMomentum: '微势',
  liMutouSpringBlossom: '春华',
  liMutouAutumnFruit: '秋实',
}

const statusNames: Record<string, string> = {
  'status:li-mutou:spring-blossom': '春华',
  'status:li-mutou:autumn-fruit': '秋实',
}

const counterNames: Record<string, string> = {
  'counter:wang-dahai:tide': '海潮',
  'counter:li-mutou:blade-domain': '刀域',
}

export function displaySkillName(skillId: string, branchId?: string | null): string | null {
  if (skillId === WANG_DAHAI_FIRST_SKILL_ID) {
    return branchId === WANG_DAHAI_STACKING_WAVE_BRANCH_ID ? '叠浪式' : '新潮式'
  }
  if (skillId === LI_MUTOU_FIRST_SKILL_ID) {
    return branchId === LI_MUTOU_AUTUMN_BRANCH_ID ? '一叶秋' : '一叶春'
  }
  return skillNames[skillId] ?? null
}

export function displayEffectName(effectId: string | null): string | null {
  return effectId === null ? null : effectNames[effectId] ?? null
}

export function displayStatusName(statusId: string): string | null {
  return statusNames[statusId] ?? null
}

export function displayCounterName(counterId: string): string | null {
  return counterNames[counterId] ?? null
}
