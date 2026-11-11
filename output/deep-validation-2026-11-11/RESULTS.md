# Deep verification — 11 November 2026

## Final results

| Area | Result |
| --- | --- |
| App, calculations, security and Worker tests | 31/31 passed (`npm test`) |
| Firestore emulator workflows and permissions | 12/12 passed |
| Production build | Passed (`npm run build`); existing large JavaScript bundle warning remains |
| Real Gemini complete suite | 10/12 passed; suspension provider error and capacity timeout |
| Targeted Gemini rechecks | Capacity passed; suspension timed out again |
| Real Dia admin | Google sign-in, announcement loading, real extraction, briefing, both-direction preview, publish and withdraw passed |
| Real Dia student | Route switching, Home/Timetable matching, unchecked-in notice hiding, Grab pages and light/dark desktop views passed |
| Real GPS check-in | Correctly rejected at 143 m reported accuracy; required accuracy is 50 m |
| Live checked-in host/join and student update | Not completed because real GPS did not pass. Covered by separate emulator clients, not claimed as live browser proof |
| Mobile layout | Not reverified in this test session |
| Public deployment | Not performed; these results describe local development with the configured Firebase project |

## Repairs made

- The local Generate briefing button now uses the authenticated local Gemini service. Hosted Firebase AI Logic and its existing fallback remain available.
- Gemini retries one temporary server failure within one overall 20-second timeout. Quota errors and malformed responses are not retried. A failure never publishes a guessed update.
- Extraction instructions avoid returning both a minute delay and a calculated revised time, or inventing incomplete affected windows.
- Removed invented fixed departures during LRT morning continuous service. Home now shows the service-start countdown, not a bus countdown. Timetable lists fixed departures from 8:45 am. Exact departure notices within the continuous period must identify an affected window.
- Private .firebase rollback files are now blocked by the development server, alongside environment files. Regression requests returned HTTP 403, including /@fs paths. No secret values are included in this report.
- Isolated Firestore regression test now clears its own emulator project before and after use, so repeated runs do not retain a previous queue entry.

Official timetable source: [APU timetable, effective 22 October 2026](https://publicwebsite-media.apu.edu.my/assets/2026-10/2026Oct22_APU-SHUTTLE-SERVICES.pdf).

## Workflow coverage

Automated tests cover each route independently and both-direction notices; check-in-required visibility; no automatic return-trip propagation; leaving and changing routes; original/revised arithmetic and reordered buses; unknown delays; cancellations, suspensions and replacements; expiry, withdrawal and conflicts; Malaysia date boundaries; continuous service; queue/capacity estimates; stale entries; fare ranking; full rooms; simultaneous joins; host/join/leave/rejoin/close; private rosters and rejected unauthorized writes.

Admin publication and withdrawal preserve queue records. Hosting and joining preserve the existing check-in. Incorrect-route joins and unapproved admin actions are denied. Expected permission-denied output from rejection tests is not a failing test.

The temporary live notice was withdrawn and the admin list showed no published announcements. No fake live queue entries or rides were created. The user's original light theme was restored. The local development server remains available at http://localhost:5173/; test emulators were stopped after verification.

Automatic approval review rejected a simulated-GPS browser fixture because it conflicted with the user's instruction to keep real GPS verification. That fixture was not run. Database code tests were used instead. No GPS bypass was introduced.

## Evidence

- [Complete real provider results](../ai-live-validation/results.json)
- [Targeted provider rechecks](provider-rechecks.json)
- [Real admin briefing](admin-briefing.png)
- [Final student Home](student-home.png)
- [Dark timetable](timetable-dark.png)

Remaining work: repeat real check-in, host/join and checked-in notice visibility with two devices whose real GPS meets the pickup requirements; verify mobile layout; recheck suspension extraction when Gemini recovers; separately configure and test public deployment.
