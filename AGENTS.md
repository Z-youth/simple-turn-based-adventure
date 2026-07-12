# Repository Guidelines

## Project Structure & Module Organization

This repository is a React 19 single-page application built with TypeScript and Vite. Application code lives in `src/`: `main.tsx` mounts the app, `App.tsx` contains the current root component, and `index.css` and `App.css` provide global and component styles. Imported images belong in `src/assets/`; files that must be served unchanged belong in `public/`. Build and compiler configuration is kept at the repository root in `vite.config.ts` and the `tsconfig*.json` files.

As the game grows, place reusable UI in `src/components/` and domain logic in focused folders such as `src/game/`, `src/models/`, or `src/hooks/`. Keep tests beside the code they cover or under `src/__tests__/` once testing is introduced.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies from `package-lock.json`.
- `npm run dev` starts the Vite development server with hot module replacement.
- `npm run build` type-checks the project and creates a production bundle in `dist/`.
- `npm run lint` runs Oxlint against the codebase.
- `npm run preview` serves the production build locally for final verification.

No automated test command or framework is currently configured. Do not claim test coverage until one is added.

## Coding Style & Naming Conventions

Follow the existing TypeScript and JSX style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Use `PascalCase` for React components and component files, `camelCase` for functions, hooks, and variables, and `kebab-case` for public asset names. Prefix custom hooks with `use`. Keep components small and move non-visual turn or combat rules out of JSX.

Run `npm run lint` and `npm run build` before submitting changes. TypeScript is configured with unused-variable and unused-parameter checks.

## Testing Guidelines

When adding a test framework, prefer colocated names such as `App.test.tsx` or `combat.test.ts`. Cover game-state transitions and edge cases with unit tests; use component tests for player interactions. Add the corresponding `npm test` script and document any coverage target in this file.

## Commit & Pull Request Guidelines

No Git history is available in this directory, so no repository-specific commit convention can be inferred. Use short, imperative subjects such as `Add turn order calculation`, and keep unrelated changes separate. Pull requests should explain behavior changes, list verification commands, link relevant issues, and include screenshots or recordings for visible UI changes.
