# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## 开发规格

- [`docs/01_GAME_DESIGN.md`](docs/01_GAME_DESIGN.md)：游戏设计基线与整体玩法目标。
- [`docs/02_PROTOTYPE_SCOPE.md`](docs/02_PROTOTYPE_SCOPE.md)：测试版范围与功能边界。
- [`docs/03_COMBAT_RULES.md`](docs/03_COMBAT_RULES.md)：战斗流程、数值与状态规则。
- [`docs/04_CONTENT_SPEC.md`](docs/04_CONTENT_SPEC.md)：角色、敌人和技能内容规格。
- [`docs/05_IMPLEMENTATION_PLAN.md`](docs/05_IMPLEMENTATION_PLAN.md)：阶段划分与实施顺序。
- [`docs/06_ACCEPTANCE_TESTS.md`](docs/06_ACCEPTANCE_TESTS.md)：自动与人工验收标准。

原始设计与用户最新确认的规则优先。Codex 开始任何开发阶段前都必须阅读 `AGENTS.md` 和 `docs/` 下的全部规格，不得根据模糊理解自行修改玩法。
