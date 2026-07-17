# 简单的回合制大冒险

一个运行在浏览器中的原创回合制战斗测试版，用于验证行动序列、角色技能、资源、护盾、触发链和训练战斗流程，不包含正式美术或完整挑战模式。

## 当前状态

- 当前 Git 基线：`a315205 feat: complete training battle prototype`。
- 基线已有王大海、严岩、李木头、训练假人，以及训练模式的配置、战斗、暂停、统计和结果流程。
- 现行规格已扩展为四名角色：王大海、严岩、李木头、流年。
- 现行 Boss 包含无限生命训练假人与有限生命、多阶段的万夫长；万夫长战斗包含骸骨将军、尸卒和不化王骑。
- 新规格纳入多敌人、召唤、协击、伤害分摊、阶段替换、跨阶段保存、延迟队列、重复释放和更精确的生命周期。
- 上述新增规格将按 `docs/05_IMPLEMENTATION_PLAN.md` 分阶段实现；“已进入规格”不代表当前代码已完成。
- 正式挑战模式仍未设计。入口只显示“开发中，不要再点啦！”提示，不进入后续流程。

## 本地运行与检查

```bash
npm run dev
npm run test
npm run lint
npm run build
```

Windows PowerShell 如遇执行策略限制，可使用 `npm.cmd run dev`、`npm.cmd run test` 等等价命令。

## 简要架构

- `src/App.tsx`：React 流程界面、战场、暂停和结果页。
- `src/game/core/`：与 React/DOM 分离的战斗状态和结算核心。
- `src/game/content/`：角色、Boss、技能及战斗扩展。
- `src/game/ui/battleUiAdapter.ts`：把引擎内容与状态适配到 UI。
- `src/tests/`：核心规则与训练流程回归。

## 现行规格

- [规格来源索引](docs/00_CURRENT_SPEC_SOURCES.md)
- [游戏设计](docs/01_GAME_DESIGN.md)
- [测试版范围](docs/02_PROTOTYPE_SCOPE.md)
- [通用战斗规则](docs/03_COMBAT_RULES.md)
- [角色与 Boss 内容规格](docs/04_CONTENT_SPEC.md)
- [实施阶段规划](docs/05_IMPLEMENTATION_PLAN.md)
- [规则验收项](docs/06_ACCEPTANCE_TESTS.md)

本地文档同步自索引所列 Google Drive 权威来源；发生冲突时，以用户最新确认、角色/Boss 专属规则和 Drive 原文为准，不根据旧代码反推玩法。
