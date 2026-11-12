# ShuttleWise

Production: **https://shuttle-wise.vercel.app** · Admin: **https://shuttle-wise.vercel.app/admin**. Vercel hosts the app and protected Gemini server function; Firebase provides sign-in and live data. See [the production deployment record](VERCEL_DEPLOYMENT.md) for verification, settings and the remaining on-site GPS test.

The React demo provides two weekday timetables, live shuttle queues and Grab shares, and an admin dashboard. The original prototype and timetable images are the design and schedule references.

Transport announcements now add reviewed temporary delays/cancellations without changing the standard timetable. Home and Timetable share the same route-specific calculations. See [AI_SETUP.md](AI_SETUP.md) for the admin workflow, safe Gemini key setup, and the local demo reset. New AI calls are not live until the Worker, keys, and App Check are configured.

The standard timetable matches the APSpace screenshots supplied on 11 November 2026: 51 Bukit Jalil LRT → APU departures, 7:30 am–6:20 pm; 39 APU → Bukit Jalil LRT departures, 10:35 am–9:45 pm. Morning LRT services have individual departure times. `src/schedule.ts` supplies the app and AI with the same timetable. Firebase `timetables/apu` and `timetables/lrt` store matching copies of this released version; they are not a separate live timetable editor. The late APU services retain their limited-space labels.

## Run locally

Use Node.js 22.12 or newer. Install dependencies and start Vite.

```sh
npm ci
npm run dev
npm run build
npm test
npm run test:rules
```

The timetable works with no Firebase settings. Firestore rules tests require Java and a local Firestore emulator download.

To test check-ins and Grab shares locally, install the Firebase CLI and Java, then run:

```powershell
npm run dev:local
```

Configure the pickup coordinates in `.env.local`, open the URL printed by Vite, and tap **Allow location & check in**. This command starts Vite with the Auth and Firestore emulators and writes test data locally. To test away from a pickup, use a browser geolocation override with the configured pickup coordinates. Stop it with Ctrl+C.

## Configure the demo

This workspace is now connected to your own Firebase project, `shutterbus`. Its sign-in providers, database rules and your admin account are configured. Start the local app and Gemini notice reader together with `npm run dev`. The old friend's database was not copied or changed; see [AI_SETUP.md](AI_SETUP.md) for the fresh-setup status and verification limits.

1. Register a web app in a Firebase Spark project. Enable anonymous and Google sign-in, provision the default Firestore database, and add the Hosting origin as an authorized Auth domain.
2. In Firebase Console, open **Project settings → General → Your apps → Web app → SDK setup and configuration → Config**. If there is no web app, register one with the **</>** button. Copy `apiKey`, `authDomain`, `projectId`, and `appId` to their corresponding entries in `.env.local` using `.env.example` as a template. Enter the confirmed latitude and longitude for each boarding spot. Check-in is disabled for routes without a configured pickup. [Firebase web setup](https://firebase.google.com/docs/web/setup)
3. For the hosted Firebase AI Logic admin briefing, register the web app with reCAPTCHA Enterprise App Check, enable enforcement for Firebase AI Logic, and use the Gemini Developer API backend. Set the site key and a supported Gemini model in `.env.local`. Local development uses the authenticated local Gemini endpoint for notice reading and admin briefing. [Firebase AI Logic setup](https://firebase.google.com/docs/ai-logic/get-started?platform=web) · [App Check setup](https://firebase.google.com/docs/ai-logic/app-check)
4. Have each intended admin sign in with Google at `/admin`. In the Firebase console, create a document at `admins/{firebaseUid}` for each authorized account. The Firestore rules use document existence and the Google sign-in provider.
5. Follow [AI_SETUP.md](AI_SETUP.md) for the Gemini travel notices, App Check, real-provider tests, and remaining owner setup. Set `APP_ORIGIN` to the exact HTTPS Hosting origin with no trailing slash, and check the Firebase identifiers in `worker/wrangler.jsonc`. Authenticate Wrangler, deploy the Worker, and add `GEMINI_API_KEY` using the interactive secret prompt. Set `VITE_AI_WORKER_URL` to the deployed Worker URL. The existing admin briefing can additionally use its OpenRouter fallback. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```sh
npx wrangler deploy --config worker/wrangler.jsonc
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.jsonc
# Optional: existing admin briefing backup
npx wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.jsonc
npm run build
npx firebase-tools deploy --only firestore:rules,hosting --project YOUR_PROJECT_ID
```

The Worker uses the Firebase ID token to read the caller’s own allowlist entry with the Firestore REST API. Its UID rate limit applies per Cloudflare location. [Firestore REST API authentication](https://firebase.google.com/docs/firestore/use-rest-api) · [Workers rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Verify the deployed demo

Use two phones at each pickup to confirm that check-ins sync, wrong-route and inaccurate locations are rejected, tapping **I got the bus** removes the student from the live queue, and hosting or joining a ride preserves the original queue spot. Check an anonymous session and a Google account without an allowlist entry against the dashboard and Worker briefing endpoint. Force failures in each AI provider and verify that computed trend figures stay visible. Track physical and deployment checks in [TODO.md](TODO.md).

Students can check in from within 50 metres of the selected pickup with a location reading accurate to 50 metres or better. The browser checks distance locally, so a modified client can bypass the geofence. Admin trends compare the latest seven Malaysia calendar days, including today, with the previous seven.

Close open rides from the previous version before switching over. The updated client can still manage an older ride for its existing members, but only new rides have browse listings. Open listings show the route, fare and seat count. Only ride members can read names and UIDs. Deploy the updated rules and Hosting bundle together because earlier clients use the old write paths.

### Pickup map references

- APU’s directions link points to `3.0554057, 101.7005614`. [APU directions](https://www.apu.edu.my/connect) · [Google Maps pin](https://www.google.com/maps/search/?api=1&query=3.0554057%2C101.7005614)
- Bukit Jalil LRT station is approximately `3.0581, 101.6919`. [Station reference](https://www.klia2.info/rail/rapidkl-lrt/ampang-line/bukit-jalil/) · [Google Maps pin](https://www.google.com/maps/search/?api=1&query=3.0581%2C101.6919)

Use a dropped pin at each actual boarding spot for the 50-metre check-in radius. The public references identify the campus and station landmarks.

### Temporary Savanna testing

The saved APU pickup remains `3.055070, 101.700573`; the saved Bukit Jalil LRT pickup remains `3.058372, 101.691650`. Do not replace these values with Savanna.

`VITE_PICKUP_PROFILE=savanna` makes both route check-ins use the separately configured Savanna Bukit Jalil pin (`VITE_SAVANNA_LATITUDE=3.056444`, `VITE_SAVANNA_LONGITUDE=101.687690`). [Google Maps place](https://www.google.com/maps/search/?api=1&query=3.056444%2C101.687690). The app shows a temporary-testing notice. The existing 50-metre pickup radius and GPS accuracy check still apply.

To restore the real pickup points, set `VITE_PICKUP_PROFILE=original` in the local environment and Vercel Production environment, then restart the local server and redeploy production. The four original coordinate variables stay unchanged. `.env.example` defaults to the original pickup points.

The requested temporary data adds 30 sample check-ins (15 per direction) and 6 sample open rides (3 per direction), using IDs beginning `sample-savanna-20261112-`. Normal local development and production use the same `shutterbus` database, so the samples are shared. Sample ride cards are labelled. These are display/test records, not real drivers or bookings.

The private manifest and management script are under ignored `.firebase/savanna-demo-2026-11-12/`. To inspect or remove only this sample set on this computer:

```sh
node .firebase/savanna-demo-2026-11-12/manage-samples.mjs inspect
node .firebase/savanna-demo-2026-11-12/manage-samples.mjs remove
```

Removal checks the exact recorded document IDs and refuses to remove a changed ride, including a ride that someone has joined. It does not reset the database. Changing the pickup profile does not itself delete sample data.

LRT restored on 13 November 2026: `VITE_LRT_PICKUP_PROFILE=original` restores only the original Bukit Jalil LRT point (`3.058372, 101.691650`). APU still follows `VITE_PICKUP_PROFILE=savanna`. Per-route overrides take priority over the shared profile. Samples are retained.
