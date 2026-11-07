# ShuttleWise demo on Firebase Spark

## Routes and timetable

- Support exactly two routes. Use the [official APU schedule effective 22 October 2026](https://publicwebsite-media.apu.edu.my/assets/2026-10/2026Oct22_APU-SHUTTLE-SERVICES.pdf): **39 APU → Bukit Jalil LRT departures, 10:35 a.m.–9:45 p.m.**, and **40 listed Bukit Jalil LRT → APU times, 7:30 a.m.–6:20 p.m.**, with continuous morning service from **7:30–8:45 a.m.**, without invented fixed times within that period.
- Use the transcribed times **Monday through Friday, Malaysia time**, as the demo schedule. Show no scheduled service on weekends. After the last departure, show that service has ended for the day and display the next weekday’s first departure separately.
- Configure each route’s pickup coordinates separately. Confirm the boarding spot before enabling check-in for that route.

## Student and admin views

- Port the [existing student prototype](student-preview.html) to **React + Vite + TypeScript** and deploy it on **Firebase Hosting**. Use anonymous Firebase Auth and Firestore for live queue and Grab listings. Use Firestore transactions and rules to enforce one active queue entry per identity, the four-person ride cap, and atomic queue-to-ride switching.
- Request a fresh location at check-in. Allow it only when the student is within **30 metres of the selected route’s pickup point** and reported accuracy is **30 metres or better**. Block check-in for an out-of-range, denied, timed-out, or inaccurate reading. Discard raw coordinates. On Spark, this browser check can be bypassed by a modified client.
- Show the live count, position among checked-in students, and next scheduled departure. Give checked-in students an **I got the bus** button that ends their check-in and updates the live count.
- Protect `/admin` with Google sign-in and a Firebase UID allowlist enforced by Firestore rules. Show live queues and historical trends for both routes. Keep labeled synthetic history separate from live check-ins. Generate briefings from computed peak windows, volumes, and period comparisons.

## AI fallback and future changes

- Use **Gemini through Firebase AI Logic with App Check** as the primary provider. When Gemini times out, hits a quota limit, returns a service error, or produces invalid output, try **OpenRouter’s `openrouter/free`** once. Use OpenRouter for the demo’s external fallback. Direct OpenAI remains an option for a later provider change. [Firebase AI Logic](https://firebase.google.com/docs/ai-logic/get-started?platform=web) · [OpenRouter free models](https://openrouter.ai/collections/free-models) · [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- Host the OpenRouter endpoint on **Cloudflare Workers Free**. Keep the API key in a Worker secret. Verify Firebase ID tokens, restrict requests to the app’s origin, and rate-limit by UID. Require an allowlisted admin for briefing requests. Send only aggregate dashboard metrics. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- If both providers fail, keep the admin charts and computed summary visible. Keep calculations, route configuration, and provider calls separate from the UI so a later move to Cloud Functions can reuse the same screens and data model.

## Acceptance checks

- Compare every transcribed departure with the screenshots. Test both directions on a weekday, after the last departure, and on a weekend.
- Test check-in at both pickup points, with the opposite route selected, outside the radius, and with denied or inaccurate location. Verify on two phones that live counts sync when someone boards, concurrent Grab joins respect the four-person cap, and a failed ride join preserves the queue spot.
- Force Gemini and then OpenRouter to fail. Verify that the fallback chain preserves the same dashboard metrics, that students cannot read admin history or request an admin briefing, and that the OpenRouter key is absent from the browser bundle.
