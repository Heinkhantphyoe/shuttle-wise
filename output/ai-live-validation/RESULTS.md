# Real Gemini verification — 8 November 2026

Provider: Google Gemini Developer API. Model: `gemini-3.5-flash-lite`.

The key was accepted by Google and real generation succeeded. `gemini-2.5-flash` returned a model-availability error for this key; the Worker now uses the verified model above. The secret is stored only in ignored `worker/.dev.vars` with owner-only file permissions.

## Real provider checks: 11/11 passed

Command: `npm run test:ai:live`. See [actual responses](results.json).

| Check | Actual result |
| --- | --- |
| APU → Bukit Jalil LRT text | Extracted the 14:30 departure and 40-minute traffic delay. Application calculation produced 15:10 and a 70-minute wait from 14:00. Earlier operating trips were reordered correctly. Opposite direction unchanged. |
| Bukit Jalil LRT → APU PNG | Read the public test image, service date, 14:25 departure, 20-minute delay and heavy-rain reason. Application calculation produced 14:45. |
| Both directions | Extracted separate departures and delays for each direction. |
| Unknown delay | Kept duration and revised time null; no invented countdown. |
| Other notice types | Real extraction passed for cancellation, suspension, explicit replacement, pickup change, capacity change, and information-only announcements. |
| Student advice | Returned valid JSON, permitted evidence references and a short explanation. The cheapest test room remained the calculated RM18 room. |

These calls use the actual production extraction/advice functions, including schema parsing, grounding and direction checks. Test notices and rooms are public artificial fixtures. No notice was published and no Firebase records were sent to Gemini. The standard timetable remained unchanged.

The first advice run incorrectly described a later delayed bus as the next bus and used an unsupported unknown-delay caution. The prompt now receives an explicit next-departure flag and permitted caution codes; the response validator rejects unsupported cautions. The final real run passed, and a regression check covers this distinction.

Information-only notices originally asked for unnecessary shuttle times. The extraction prompt now clearly separates general information from operational changes. The final full live-provider suite passed after this correction.

## Local checks

- `npm test`: **26/26 passed**.
- Firestore emulator tests: **8/8 passed** in the Firestore emulator. Permission-denied logs are expected negative-access cases.
- `npm run build`: **passed**. Existing large-bundle warning remains.
- Wrangler deployment dry run: **passed**; Worker bundle and configured bindings validated without uploading.
- Secret isolation check: local secret ignored by Git, file mode 0600, no matching secret in source, public reports or the production bundle.

## Still pending: hosted app

No Worker deployment, remote secret upload or Firebase deployment occurred. Cloudflare CLI is not authenticated. The signed-in Google account cannot access the existing Firebase project, which the user confirmed belongs to a friend. The supplied `.env` gives web app configuration, not administrative access.

The live website still needs the owner's App Check registration/public site key, Cloudflare Worker URL and secret, matching frontend/rules deployment, and a two-session hosted admin-to-student check. See [owner steps](../../AI_SETUP.md). No security checks were disabled to bypass the missing access.

The existing Firebase AI Logic admin history briefing and its OpenRouter fallback were preserved. Their live provider setup was not tested by these Gemini travel tests.
