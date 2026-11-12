# ShuttleWise on Vercel

Production website: https://shuttle-wise.vercel.app

Only the separate `shuttle-wise` Vercel project is used. Firebase remains the `shutterbus` project. No existing Vercel project, team secret, account setting or billing setting was changed.

## How it runs

- Vercel builds the Vite student and admin pages. `/admin` loads the same app shell.
- `/ai/*` routes go to the Vercel server function in `api/ai.ts`.
- The server reuses the existing Gemini extraction, briefing and advice code. The browser never receives the Gemini key.
- Firebase ID tokens, Google admin allowlisting and Firebase App Check are checked before AI requests.
- Private Firestore `aiRateLimits/{uid}` counters enforce six requests per minute across Vercel instances. Users cannot read another user's counter, delete it, reduce it or reset it early.
- Firestore continues to handle queues, rides, announcements and history using the app's rules.

The TypeScript setting `rewriteRelativeImportExtensions` is required so emitted server JavaScript imports `.js` modules instead of missing `.ts` modules.

## Project settings

Build: `npm run build` · Install: `npm ci` · Output: `dist` · Function region: Singapore (`sin1`).

These are configured only for this project's production environment:

| Setting | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Existing public Firebase web configuration |
| `VITE_APU_LATITUDE`, `VITE_APU_LONGITUDE`, `VITE_LRT_LATITUDE`, `VITE_LRT_LONGITUDE` | Pickup coordinates |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Public App Check site key, restricted to the production website |
| `VITE_AI_BACKEND=vercel` | Use the same-origin hosted AI function |
| `APP_ORIGIN` | Exact production origin |
| `FIREBASE_PROJECT_ID`, `FIREBASE_PROJECT_NUMBER`, `FIREBASE_APP_ID` | Server-side Firebase verification identifiers |
| `GEMINI_MODEL` | Existing Gemini model selection |
| `GEMINI_API_KEY` | Private, server-only sensitive environment variable |

Do not add the Gemini key to a `VITE_` setting, source code, Git or the browser. `.env`, `.firebase`, Worker private files, Git metadata and local reports are excluded from deployment uploads.

The LRT pickup is restored to the project's Bukit Jalil station reference: **3.058372, 101.691650**, in both the local environment and production. GPS accuracy and the actual boarding spot still need on-site confirmation.

Firebase Auth allows `shuttle-wise.vercel.app` in addition to the existing domains. A new score-based reCAPTCHA Enterprise site key named **ShuttleWise Vercel production** protects the existing Firebase web app through App Check. Existing keys were not changed. No App Check enforcement was disabled.

## Validation

- `npm test`: 38/38 passed.
- `npm run test:rules`: 14/14 passed.
- `npm run build`: passed; existing large-bundle warning remains.
- Emitted server JavaScript imported successfully and rejected an unsigned request with HTTP 401.
- The initial production build exposed a server import error; the follow-up deployment enables TypeScript extension rewriting. See the final verification record below.

### Final live verification — 11 November 2026

The corrected production deployment is `dpl_5XYKeA2bcrnGx63ytNSNv2ad291S` and Vercel reports **READY**. It serves https://shuttle-wise.vercel.app.

Verified in Dia: production `/admin` loads, allowlisted Google sign-in succeeds, live queues and history load, and real Gemini reads an information-only message covering both routes. The preview shows both directions and the calculated expiry. Publishing to Firestore succeeds, withdrawal succeeds, and a real Gemini admin briefing is returned. The production QA notice was withdrawn; the admin list showed **No published announcements**. Existing expired notices remain in history.

Verified in Safari: the production student page starts an anonymous Firebase session, displays the live APU and LRT queue counts, navigates to both timetable/Grab views, disables hosting before check-in and loads the open-ride query without a permission error. An unchecked-in student does not receive the test announcement.

The normal 5:10 pm rain delay had already ended; its original timetable row was shown in the hosted student timetable and its record remained in expired admin history.

### Test data reset — 11 November 2026, after deployment

At the user's request, the stored testing data was backed up privately and 32 operational documents were removed: two check-ins, test ride records/memberships/listings, seven history events, test announcements/audits, the notice revision record and the AI quota counter. All nine operational collections were verified empty afterward. The live production admin dashboard showed **0 students on both routes**, no published announcements and zero live history.

Admin access, Firebase Auth accounts, route settings, security rules, Firebase/Vercel configuration and API keys were preserved. The private backup is under ignored `.firebase/production-2026-11-11/test-cleanup-2026-11-11T10-07-59-442Z/`. Future shared-Firebase tests must track and clean up their own document IDs before handoff; this is recorded in `AGENTS.md`.

The public root and `/admin` return HTTP 200. The repaired AI function returns HTTP 401 JSON for an unsigned request, rather than a server startup error. Private environment/Worker/Firebase paths return 404.

Positive production check-in, hosting and joining still require an on-site test at the actual pickup. No GPS override was used. The prior two-browser local test and both-route emulator workflows are documented separately in `output/two-browser-validation-2026-11-11/RESULTS.md`.

The npm audit findings come from the Firebase Node gRPC dependency. These advisories concern gRPC server behavior. This Vercel function uses authenticated Firestore REST requests and does not run a gRPC server. No forced Firebase downgrade or unrelated dependency migration was performed.

## Updating

This release was deployed directly from selected local source files using the connected Vercel API. GitHub was not pushed or changed. Keep the hosting files with the project before setting up automatic Git deployments.

Production environment changes require a new deployment. Preview deployments do not receive the production-only private key or App Check domain; keep them separate unless explicitly setting up preview verification.

After any deployment, check `/`, `/admin`, anonymous student data, Google admin sign-in, real notice extraction and admin briefing. Check that `/.env`, `/worker/.dev.vars` and `/.firebase/*` return 404, and unsigned AI requests return 401. Test check-in, host and join at the real pickup points; do not bypass production GPS.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Firebase App Check](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

Timetable correction, 11 November 2026 at 10:53 pm Malaysia time: deployment `dpl_BvGAeeTRMbXEeMnMAQPxXjiF5pvG` is READY on https://shuttle-wise.vercel.app. Standard times now match the user's two APSpace screenshots: 51 Bukit Jalil → APU fixed departures from 07:30, and 39 APU → Bukit Jalil departures from 10:35. Both complete route lists were checked in Dia and Safari. Firebase `timetables/lrt` and `timetables/apu` hold matching release copies; application and AI calculations continue to use the shared bundled schedule. All 39 tests and the production build pass. See `output/timetable-correction-2026-11-11/RESULTS.md` for verification.

### Admin notice UI — 12 November 2026

Deployment `dpl_FDKBvWFfyrDcj7GqLM5N79ghhBx2` is READY on https://shuttle-wise.vercel.app. It uses GitHub commit `216e3a7` on `main`. The admin form now uses **Create notice preview**, includes a short three-step guide, and provides a styled direction dropdown with keyboard controls. The previous deployed timetable correction is also synced to GitHub in `c7f6b99`.

The build and all 39 tests pass. Desktop/mobile layout and dropdown interactions were checked. In the signed-in production Dia session, real AI returned the expected notice preview; no test announcement was published. Public `/` and `/admin` return 200, private paths return 404, and an unsigned AI request returns 401. The 15-minute Vercel runtime scan found no errors. See `output/admin-ui-2026-11-12/RESULTS.md` and `production-checks.json` for the verification record.
