# Dia and Safari deep testing — 11 November 2026

Tested the local development app at `http://localhost:5173/` with the configured Firebase service. Dia and Safari used separate student sessions. Admin sessions were also available. This was a real two-browser test on one Mac, not a two-phone or public-hosting test.

## Result

- App, timetable, pickup, AI endpoint and security tests: **34/34 passed**.
- Firestore emulator workflow and permission tests: **13/13 passed**.
- Production TypeScript check and Vite build: **passed**. The existing large-bundle warning remains.
- Whitespace check: `git diff --check` passed.
- Final real Gemini full suite: **12/12 passed**, including suspension, capacity, student explanation and admin briefing. See `provider-results.json`.

The first real Gemini suite passed 11/12 cases. Student advice sometimes repeated numeric times/durations, which the strict validator correctly rejected; a diagnostic recheck also claimed a missing fare reference was available. The advice prompt now explicitly prohibits those numeric details and states whether a fare reference exists. The response schema also restricts evidence IDs and caution codes to the supplied facts. Validation was kept intact. Three targeted real-provider advice rechecks passed after the repair; see `advice-rechecks.json`.

## Fixed: automatic announcement expiry

Before this repair, an AI-read notice for a 5:10 pm bus delayed by 40 minutes kept its midnight expiry. The student announcement could remain long after that bus's revised time.

Notices with known affected times now stop applying after the last original or revised service minute. The 5:10 pm bus delayed by 40 minutes stays updated through 5:50 pm, then returns to the normal timetable at **5:51 pm Malaysia time**. The app recalculates every second; no refresh or database deletion is needed. This applies to older saved notices with midnight expiry too.

Each direction ends independently when a notice covers both directions. Multi-departure notices cover the last affected departure. Overnight minute delays retain their revised date. A delay without a confirmed duration or end keeps its stated expiry; the app does not guess when that delay ends.

Expired announcements disappear from students and the admin's active list. The saved record stays in the admin's collapsed **Expired announcements** history. This is automatic hiding and removal of the temporary timetable effect, not permanent deletion from Firestore.

The original timetable dataset is never overwritten. If another valid notice is still active, that other notice continues to apply. Queue spots are unaffected by notice expiry.

The admin list now updates with the clock. Past-service AI results show a correction message and cannot be published. Student details and admin previews show the calculated expiry time.

## Real browser workflows

| Feature or control | Observed result |
| --- | --- |
| Independent students | Initially Dia was queue position #1 and Safari #2; later boarding/re-check-in changed the order correctly. |
| Home, Timetable and Grab navigation | Worked in both browsers. Home and Timetable agreed about the 5:10 → 5:50 pm change. |
| Route picker | Both routes selectable. Wrong-route state identified the existing pickup and disabled hosting there. |
| Route-specific notices | The LRT delay appeared on the checked-in LRT route and disappeared on the APU route. |
| Leave queue | Dia released its spot; the count fell from 2 to 1 and its announcements disappeared. |
| Fresh check-in | Dia and Safari successfully checked in using normal browser GPS against the configured pickup. No GPS override was used. |
| Wrong pickup | APU check-in from the current reported position was rejected as outside the 50-metre pickup area. |
| I got the bus | Tested in both browsers. Removed only that student's check-in and hid that student's notices. |
| Live admin queues | Changed with leave, boarding and check-in. |
| Check-in history | Increased with new check-ins; leaving/boarding did not erase history. |
| Dia hosts, Safari joins | Created an RM 20 ride; Safari saw it without refreshing, joined and both saw 2 people at RM 10 each. |
| Fare change | Dia changed the total to RM 24; both saw RM 12 each and Safari received the fare-update message. |
| Leave ride | Safari left; Dia returned to 1 person at RM 24. Shuttle check-ins stayed in place. |
| Rejoin | Safari joined again and both saw 2 people at RM 12 each. |
| Cancel confirmation / Go back | Opening and dismissing the dialog kept the ride open. |
| We have departed | Dia closed the first ride; Safari received the departure message and could host another ride. Queue spots remained, as designed. |
| Safari hosts, Dia joins | Safari created an RM 18 ride; Dia joined and both saw 2 people at RM 9 each. |
| Cancel ride | Safari confirmed cancellation; Dia received the cancellation message and no open ride remained. |
| Admin sign-out and Google sign-in | Dia signed out, saw the sign-in screen and signed back in successfully. |
| Admin direction and empty form | Empty form could not run AI; selected directions controlled the preview. |
| Missing reason | Incomplete test input showed the missing-reason message instead of a publish button. |
| Read with AI | Real Gemini produced a both-direction information notice with the correct affected window and expiry. |
| Publish announcement | The test notice reached checked-in students without a refresh. |
| Edit update / Publish correction | Version increased from 1 to 2; the corrected reason and summary reached students. |
| Automatic expiry | The information notice with window 5:13–5:16 pm disappeared at the 5:17 pm expiry, without refresh. Admin moved it to expired history. The separate rain delay remained active. |
| Expired history | Expanded and displayed the expired test notice with its correct end time. |
| Notice details | Showed affected direction, source text, correction time and calculated expiry. |
| Image upload | Safari selected the existing PNG fixture and displayed its preview. |
| Image AI / past-service guard | AI read the 9 November image. Publication was blocked with “These affected services have already ended.” |
| Remove image | Removed the preview and reset the file field; empty Read with AI became disabled. |
| Withdraw | A second information-only test notice was published then withdrawn. Both admin views updated; final checked-in student views showed only the original rain delay. |
| Generate briefing | Returned a real AI summary based on the live numeric history. |
| Student/Admin menu | Opened and navigated between the views. |
| Theme | Dia dark mode rendered correctly; light mode was restored. |

## Automated edge cases

The app suite covers exact expiry boundaries, restoration of original timetable rows, next-day behavior, independent direction expiry, multiple departures, known and unknown delays, window changes, cancellation, suspension, replacement, capacity, fare ranking, stale queues, continuous morning service, Malaysia date boundaries, conflicting announcements and invalid AI responses.

The emulator suite covers both routes, concurrent joins, the four-person cap, duplicate joins, wrong-route joins, invalid names/fares, host-only management, leave/rejoin, cancellation/departure, preserved queues, private rosters, unauthorized admin writes, atomic conflict replacement and stale versions. Its new saved-notice test reads the same midnight-expiry delay from two student clients, checks that it applies at 5:50 pm and stops at 5:51 pm, confirms the timetable is restored, and confirms both check-in records and the saved notice remain unchanged. Permission-denied output in rejection cases is expected.

## Limits and final state

- The configured LRT pickup differs from `.env.example`. GPS success proves behavior against the current configured point. The actual LRT boarding pin and APU boarding pin still need on-site verification. No coordinates were changed during this task.
- Positive real APU check-in/hosting was not tested at APU; both-route database operations passed in the emulator.
- This run did not test phones, mobile layouts, a public hosted app, or a deployed Worker.
- Student AI explanation was tested through its backend function. The current student page uses the calculated timetable and Grab views and does not call the optional `journeyAdvice` helper.
- The full 5:10 → 5:50 delay boundary was checked in deterministic app and two-client database tests. The real-clock browser expiry used a short information notice; the original rain notice was preserved.
- Two browser sessions remain checked in, matching the starting count of two. Re-check-in created real history entries and changed queue order. Test history was not erased.
- Both test rides were closed. The temporary withdrawal notice was withdrawn. The automatically expired QA notice remains in admin history. The user's original rain-delay notice remains active until its calculated expiry.
- Existing development server was kept running. Temporary Firestore test emulators were stopped.
