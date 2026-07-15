# 简单的回合制大冒险

一个运行在浏览器中的原创回合制战斗测试版。项目用于验证行动序列、角色技能、资源、护盾与训练流程，不包含正式美术或完整挑战内容。

## 当前可用功能

- 初始页、模式选择、队伍与站位配置、Boss 选择，以及可直接进入的训练战斗。
- 当前已实现角色与训练假人 Boss 的数据驱动配置；队伍可选 1 至 4 名角色，每个站位仅可配置一人。
- 玩家回合会根据实际可行动单位显示可用技能；既有战斗引擎负责自动行动、资源支付、死亡和后续结算。
- 训练可手动暂停；全员倒下也会暂停。暂停后可只读查看完整日志与战场、重置，或经确认退出。
- 击败有限生命 Boss 时显示基于真实战斗事件统计的结果页，支持同队伍、站位与 Boss 重新开始或退出。

> 挑战模式目前只显示“开发中，不要再点啦！”，尚未实现完整流程。

## 本地运行与检查

```bash
npm run dev
npm run test
npm run lint
npm run build
```

在 Windows PowerShell 如遇执行策略限制，可使用 `npm.cmd run dev`、`npm.cmd run test` 等等价命令。

## 简要架构

- `src/App.tsx`：React 流程界面、战场展示、暂停页与结果页；只负责交互和渲染。
- `src/game/core/`：与 React/DOM 分离的战斗状态、行动序列、伤害、资源、状态与训练结算核心。
- `src/game/content/`：角色、Boss 和技能的内容定义及战斗扩展。
- `src/game/ui/battleUiAdapter.ts`：将已注册内容和核心战斗接口适配到 UI，不在 UI 中重复实现规则。
- `src/tests/`：Vitest 覆盖核心规则与训练流程回归。

## 规则来源

以下 Google Drive 设计文档是现行规则权威；README 不复述具体规则：

- [《创意收集整理》](https://docs.google.com/document/d/15x5R38AizpdmDYkoJCZoq5ii5TBPNJ7dsLgFcjLkLeY/edit)
- [《游戏流程》](https://docs.google.com/document/d/17Ra7low9mremr0kd4OxGrf4KZ9oM4e5o1s_0SDTC_Q8/edit)
- [《通用战斗规则》](https://docs.google.com/document/d/1Cz9U_L46iw0Xm8pIEYnB2Vk5MrZDX0P7TmiXCID-YfQ/edit)
- [《角色档案》](https://docs.google.com/document/d/1Q5mxC_4zWcE2tjtZGFKLMWJeObHyEkCS7WWhaM_T7kw/edit)
- [《boss档案》](https://docs.google.com/document/d/1Jcxk6ggsxKWifpKlMcEIja-nhy3r9vb1Rn2eEctAQKk/edit)

仓库中的 `docs/` 是同步参考与验收材料，不替代上述现行设计文档；如有冲突，以用户最新确认和 Google Drive 原文为准。
