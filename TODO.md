# ShuttleWise to-do list

Based on [PLAN.md](PLAN.md). Check off each task once its result has been verified.

## Preparation

- [x] Locate the [student prototype](student-preview.html) and both timetable images ([APU to LRT](APUtoLRT.png) and [LRT to APU](LRTtoAPU.png)).

## Routes and timetable

- [x] Transcribe and compare every departure against the timetable images. APU → Bukit Jalil LRT has 39 departures from 10:35 a.m. to 9:45 p.m. Bukit Jalil LRT → APU has 51 departures from 7:30 a.m. to 6:20 p.m.
- [x] Implement Monday–Friday service in Malaysia time for exactly those two routes. Show no scheduled service on weekends. After the final departure, show that service has ended for the day and list the next weekday’s first departure separately.
- [x] Configure and deploy the supplied pickup coordinates for both routes.

## Student app

- [x] Port the student prototype to React, Vite, and TypeScript and prepare Firebase Hosting configuration.
- [x] Publish the frontend to Firebase Hosting on the Spark project and verify the student and admin routes respond.
- [x] Create the default Firestore database and publish the security rules.
- [ ] Enable anonymous and Google sign-in and verify live features on Hosting.
- [x] Wire anonymous Firebase Auth and Firestore listeners for route queues and Grab listings.
- [x] Enforce one active queue entry per identity and a four-person ride cap with Firestore transactions and rules. Make queue-to-ride switching atomic so a failed join preserves the queue spot.
- [x] Request fresh browser location on check-in. Require a distance of at most 30 metres from the selected pickup point and reported accuracy of 30 metres or better. Reject denied, timed-out, inaccurate, and out-of-range readings, and discard raw coordinates. Document that a modified browser client can bypass the check on Spark.
- [x] Show the next scheduled departure separately and end the current check-in when the student taps **I got the bus**.

## Admin dashboard

- [x] Protect `/admin` with Google sign-in and enforce the Firebase UID allowlist in Firestore rules.
- [ ] Provision the intended admin UID allowlist in the Firebase project and verify Google sign-in on Hosting.
- [x] Show live queues and historical trends for both routes. Label synthetic history and keep it separate from live check-ins.
- [x] Compute peak windows, volumes, and period comparisons for the dashboard and admin briefings.

## AI and fallback

- [x] Implement Gemini through Firebase AI Logic with App Check and a single OpenRouter `openrouter/free` fallback for provider failures or invalid output.
- [ ] Enable Firebase AI Logic and App Check enforcement in the Firebase project and configure a Gemini model.
- [x] Implement the Cloudflare Worker endpoint with Firebase token verification, exact origin checks, and UID rate limiting.
- [ ] Deploy to Cloudflare Workers Free and set the OpenRouter key as a Worker secret.
- [x] Require an allowlisted admin for briefing requests. Send only aggregate dashboard metrics to providers.
- [x] If both providers fail, keep the admin charts and computed summary visible.
- [x] Keep calculations, route configuration, and provider calls separate from the UI so the screens and data model can be reused in a future Cloud Functions migration.

## Acceptance checks

- [x] Verify both directions during weekday service, after the last departure, and on a weekend with schedule tests.
- [ ] Test fresh location at both pickups, with the opposite route selected, outside the radius, and with denied, timed-out, or inaccurate location.
- [ ] Use two phones to verify that live counts sync when someone boards, concurrent Grab joins respect the four-person cap, and a failed ride join preserves the queue spot.
- [x] Verify in local tests that the same metrics reach the fallback once, the Firestore rules deny student history reads, and the Worker rejects student briefing requests.
- [x] Inspect the browser bundle for OpenRouter configuration or secrets.
- [ ] Force Gemini to fail, then force OpenRouter to fail on the deployed app. Verify that dashboard metrics stay consistent through both fallbacks.
- [ ] Verify the deployed Firestore rules and Worker deny student access to admin history and briefings.
