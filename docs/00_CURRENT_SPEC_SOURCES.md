# 现行规格来源与索引

## 1. 权威来源与优先级

现行规格以用户最新明确确认和下列 Google Drive 文档为准。发生冲突时，按以下顺序处理：

1. 用户最新明确确认。
2. 角色或 Boss 的专属规则。
3. 《通用战斗规则》。
4. 《游戏流程》。
5. 本地 `docs/` 同步稿与 README。

不得根据旧代码、历史实现或旧本地文档反推玩法；权威来源未明确的内容必须保留为未定。

| 权威文档 | 链接 | 本地对应文件 | 负责范围 |
| --- | --- | --- | --- |
| Codex 后续开发阶段规划 | https://docs.google.com/document/d/1oy1NknKc5-zURiATS51NE3GS6YjIv1DxkdFKhPxsCAw/edit | `05_IMPLEMENTATION_PLAN.md`、`06_ACCEPTANCE_TESTS.md` | 阶段 0～7 的依赖、顺序、验收边界与非目标 |
| 游戏流程 | https://docs.google.com/document/d/17Ra7low9mremr0kd4OxGrf4KZ9oM4e5o1s_0SDTC_Q8/edit | `01_GAME_DESIGN.md`、`02_PROTOTYPE_SCOPE.md`、README | 启动、模式、编成、Boss 选择、训练、暂停、结果页和界面流程 |
| 通用战斗规则 | https://docs.google.com/document/d/1Cz9U_L46iw0Xm8pIEYnB2Vk5MrZDX0P7TmiXCID-YfQ/edit | `03_COMBAT_RULES.md` | 生命周期、触发链、持续时间、支付、伤害、死亡、召唤与训练例外 |
| 角色档案 | https://docs.google.com/document/d/1Q5mxC_4zWcE2tjtZGFKLMWJeObHyEkCS7WWhaM_T7kw/edit | `04_CONTENT_SPEC.md` | 王大海、严岩、李木头、流年及角色专属规则 |
| Boss 档案 | https://docs.google.com/document/d/1Jcxk6ggsxKWifpKlMcEIja-nhy3r9vb1Rn2eEctAQKk/edit | `04_CONTENT_SPEC.md` | 训练假人、万夫长、骸骨将军、尸卒、不化王骑及阶段规则 |

## 2. 本地文档职责

- `01_GAME_DESIGN.md`：总体定位、流程、训练模式和当前正式内容。
- `02_PROTOTYPE_SCOPE.md`：现阶段纳入范围、尚未实现范围与明确非目标。
- `03_COMBAT_RULES.md`：实现所需的通用数值、顺序、条件与例外。
- `04_CONTENT_SPEC.md`：角色、Boss、召唤物的完整专属数值与结算顺序。
- `05_IMPLEMENTATION_PLAN.md`：阶段规划的实施依赖，不新增玩法。
- `06_ACCEPTANCE_TESTS.md`：现行规则的可执行验收口径，不替代规则正文。
- README：项目现状与入口索引，不重复详细规则。

本次同步基线为 `a315205 feat: complete training battle prototype`。文档中“现行规格”表示已经确认并应进入后续开发计划，不等同于当前代码已经实现。
