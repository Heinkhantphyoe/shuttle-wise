# Repository Guidelines

## Project Structure

ShuttleWise is a React and TypeScript app built with Vite. `src/main.tsx` selects the student view (`src/student.tsx`) or the dashboard (`src/admin.tsx`) at `/admin`. Timetable and pickup logic live in `src/schedule.ts` and `src/pickup.ts`. Firestore queue and ride operations live in `src/live.ts`, with permissions in `firestore.rules`.

The Cloudflare Worker entry point is `worker/index.ts`. It shares the AI request and response contract in `src/ai-contract.ts` with the browser. Tests live in `tests/`. The root `student-preview.html`, `APUtoLRT.png`, and `LRTtoAPU.png` are design and timetable references.

## Build, Test, and Development

Use Node.js 22.12 or newer.

- `npm ci` installs the locked dependencies.
- `npm run dev` starts Vite. The timetable works without Firebase configuration.
- `npm run build` type-checks the app and Worker, then builds the app into `dist/`.
- `npm test` runs `tests/*.test.mjs` using Node’s built-in test runner.
- `npm run test:rules` runs `tests/firestore.mjs` against the local Firestore emulator. It requires Java and an emulator download on first use.

## Coding Style

Follow the existing TypeScript style with two-space indentation, single quotes, and no trailing semicolons. Use `.tsx` for React views and `.ts` for shared logic. Use PascalCase for components and types, camelCase for functions and variables, and lowercase module filenames such as `ai-contract.ts`. The build enforces strict TypeScript checking.

## Testing

Use descriptive `test()` names and `node:assert/strict`. Add unit cases to the relevant `*.test.mjs` suite. Use the emulator suite for changes to Firestore permissions or queue and ride transactions. For timetable changes, verify service-day boundaries in Malaysia time. For pickup or live queue changes, follow the two-phone checks in `README.md`.

## Commits and Pull Requests

Use short, imperative commit subjects, for example `Fix weekend timetable rollover`. In the PR description, summarize the behavior change, link any related issue, and list the checks you ran. Include screenshots for visible UI changes and call out any Firestore rules or deployment configuration changes.

## Local Configuration

Use `.env.example` as the template for `.env.local`. Store the OpenRouter API key as a Worker secret. Follow `README.md` for Firebase and Worker setup.
