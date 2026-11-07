# AI Travel Rescue validation

Checked locally on 8 November 2026, Malaysia time. No production deployment or live Gemini call was performed.

## Current admin workflow

One Admin update form contains the affected direction, update message, optional image, and Read with AI. The admin includes the date, affected departure/time period, change or delay, and reason in the message. AI creates the student notice and structured timing changes. Its read-only result appears in the same card before publishing. Missing details are corrected in the original message.

There is no separate review form and no student title, summary, reason, date, or expiry field to fill in.

## Results

| Check | Result |
| --- | --- |
| `npm test` | 24 tests passed |
| `npm run build` | Passed: strict TypeScript and Vite build |
| Firestore emulator suite | 5 tests passed; rules and database write paths unchanged by the form simplification |
| Updated two-session browser flow | Passed using mocked AI extraction and real local Auth/Firestore operations |
| Current admin mobile form | No horizontal overflow at 390×844 |
| Existing student light/dark and narrow/landscape checks | Passed in the initial implementation |
| Browser runtime errors in the updated flow | None |
| `git diff --check` | Passed |

Vite still reports its existing warning about a JavaScript chunk larger than 500 kB. The build succeeds. No new runtime or UI dependency was added.

## Updated browser flow

The browser clock was set to Monday, 9 November 2026, at 2:00 pm for the timetable scenario. Local fixtures used 40 check-ins per direction, sample capacity 24, and RM18/RM22/RM25 total-fare rooms. These are demo data, not real university announcements.

- Confirmed there is exactly one announcement form, with direction beside the message and no old title/summary fields.
- Confirmed the selected direction and original message are sent to extraction.
- Read a mocked AI result and published it from the same card through real Firestore permissions.
- Verified the student Home comparison updated for the affected direction and did not change the opposite route.
- Edited the existing announcement as one plain message and published a both-direction correction with separate affected times.
- Verified editing the message or direction removes the stale AI result and its publish button.
- Verified missing affected times block publication and direct the admin to correct the message.
- Simulated AI failure: the message remained in the form and nothing was published.
- Withdrew the notice and verified the temporary effect disappeared.
- Inspected the single form and inline result at 390px with no horizontal overflow or browser runtime errors.

## Automated coverage

Unit/Worker cases cover exact-trip and both-direction isolation; the selected admin direction constraining AI output; original/revised countdown arithmetic; matching revised times for different buses; replacement-only deduplication; cancellation/suspension boundaries; missing duration; conflicts; expiry; withdrawal; demo separation; capacity and queue boundaries; nanosecond timestamp ordering; sen/ringgit calculations; rush-hour boundaries; unavailable data; advice freshness; structured-output validation; unsupported numeric delay extraction; invalid images and oversized requests; Firebase authentication; App Check; admin allowlisting; origin and rate limits; canonical server context; per-user advice caching; and provider failures.

Firestore cases cover admin-only publication/settings, student published-only reads, private audits, correction versions, explicit supersession, simultaneous conflicting publication, preserved queue entries, and the existing boarding and concurrent Grab transactions.

Gemini responses were mocked in automated and updated browser tests. Live key validity, quota, model availability, production App Check, production Firestore reads, physical pickup locations, and real phones remain deployment/environment checks. Follow [AI_SETUP.md](../../AI_SETUP.md) after adding credentials.

## Screenshots

- [Current single admin form](admin-one-form.png)
- [Current inline AI result in the same form](admin-one-form-preview.png)
- [Student delay and travel comparison, light](student-delay-light.png)
- [Student LRT route with both-direction notice, dark](student-lrt-dark.png)
