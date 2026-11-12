# APSpace timetable correction — 11 November 2026

Source: the two APSpace screenshots supplied by the user at 10:38 pm and 10:39 pm. These screenshots replace the earlier continuous-morning-service interpretation.

- Bukit Jalil LRT → APU: 51 fixed departures, 07:30–18:20.
- APU → Bukit Jalil LRT: 39 fixed departures, 10:35–21:45. Every entry already matched and was checked again.
- Restored all 12 departures before 08:45 to the effective timetable, including 07:30. Removed the continuous-service banner and exception in announcement validation.
- Student Home, Timetable, admin announcement validation and AI journey facts share the corrected schedule.
- Firestore `timetables/apu` and `timetables/lrt` now contain the same release lists, timezone, weekdays and source version `APSpace_20261111`. There were no previous standard timetable documents. The app still uses the bundled shared schedule; these database documents are release copies, not a live editor.
- Only those two timetable documents were written. No queue, rides, users, admins, settings or notices were deleted or changed. No production check-ins or announcements were created for testing.

Validation:

- 39/39 automated tests pass. Includes an independent full transcription comparison for both directions, the next morning departure, time-window suspensions, exact morning announcements, expiry restoring the original time, weekend rollover and Malaysia dates.
- The local AI test used a fixed clock so its 17:10 fixture does not expire depending on when tests run.
- Production build and TypeScript check pass.
- Firebase readback compared all departures and source versions with the shared schedule after an atomic two-document commit. The private backup and readback report are under `.firebase/production-2026-11-11/timetable-2026-11-11T14-47-18-623Z/`.

Production verification:

- URL: https://shuttle-wise.vercel.app
- Target: production; status READY.
- Deployment: `dpl_BvGAeeTRMbXEeMnMAQPxXjiF5pvG`.
- Both route timetables were opened on the live site in Dia and Safari. Both displayed the full matching lists. Bukit Jalil starts at 7:30 am, followed by 7:35, 7:40, 7:50, 7:55, 8:00, 8:05, 8:15, 8:20, 8:25, 8:30 and 8:35 before 8:45. APU starts at 10:35 am and ends at 9:45 pm.
- The live JavaScript bundle contains `APSpace_20261111`, includes the morning times and has no old continuous-service banner. Timetable page and asset return HTTP 200. Unsigned AI extraction returns HTTP 401, as expected.
- The Vercel runtime log query returned no entries for this new deployment. This check did not make a paid Gemini request.
- No new live queue, ride or announcement test records were created.
