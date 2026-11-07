# ShuttleWise

The React demo provides two weekday timetables, live shuttle queues and Grab shares, and an admin dashboard. The original prototype and timetable images are the design and schedule references.

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

## Configure the demo

1. Register a web app in a Firebase Spark project. Enable anonymous and Google sign-in, provision the default Firestore database, and add the Hosting origin as an authorized Auth domain.
2. In Firebase Console, open **Project settings → General → Your apps → Web app → SDK setup and configuration → Config**. If there is no web app, register one with the **</>** button. Copy `apiKey`, `authDomain`, `projectId`, and `appId` to their corresponding entries in `.env.local` using `.env.example` as a template. Enter the confirmed latitude and longitude for each boarding spot. Check-in is disabled for routes without a configured pickup. [Firebase web setup](https://firebase.google.com/docs/web/setup)
3. Register the web app with reCAPTCHA Enterprise App Check, enable enforcement for Firebase AI Logic, and use the Gemini Developer API backend. Set the site key and a supported Gemini model in `.env.local`. [Firebase AI Logic setup](https://firebase.google.com/docs/ai-logic/get-started?platform=web) · [App Check setup](https://firebase.google.com/docs/ai-logic/app-check)
4. Have each intended admin sign in with Google at `/admin`. In the Firebase console, create a document at `admins/{firebaseUid}` for each authorized account. The Firestore rules use document existence and the Google sign-in provider.
5. Set `APP_ORIGIN` to the exact HTTPS Hosting origin with no trailing slash, and `FIREBASE_PROJECT_ID` to the project ID in `worker/wrangler.jsonc`. Authenticate Wrangler, deploy the Worker, and add the OpenRouter key using Wrangler’s interactive secret prompt. Set `VITE_AI_WORKER_URL` to the deployed Worker URL. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```sh
npx wrangler deploy --config worker/wrangler.jsonc
npx wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.jsonc
npm run build
npx firebase-tools deploy --only firestore:rules,hosting --project YOUR_PROJECT_ID
```

The Worker uses the Firebase ID token to read the caller’s own allowlist entry with the Firestore REST API. Its UID rate limit applies per Cloudflare location. [Firestore REST API authentication](https://firebase.google.com/docs/firestore/use-rest-api) · [Workers rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Verify the deployed demo

Use two phones at each pickup to confirm that check-ins sync, wrong-route and inaccurate locations are rejected, tapping **I got the bus** removes the student from the live queue, and failed ride joins preserve the queue spot. Check an anonymous session and a Google account without an allowlist entry against the dashboard and Worker briefing endpoint. Force failures in each AI provider and verify that computed trend figures stay visible. Track physical and deployment checks in [TODO.md](TODO.md).

Students can check in from within 30 metres of the selected pickup with an accurate location reading. The browser checks distance locally, so a modified client can bypass the geofence. Admin trends compare the latest seven Malaysia calendar days, including today, with the previous seven.

Close open rides from the previous version before switching over. The updated client can still manage an older ride for its existing members, but only new rides have browse listings. Open listings show the route, fare and seat count. Only ride members can read names and UIDs. Deploy the updated rules and Hosting bundle together because earlier clients use the old write paths.

### Pickup map references

- APU’s directions link points to `3.0554057, 101.7005614`. [APU directions](https://www.apu.edu.my/connect) · [Google Maps pin](https://www.google.com/maps/search/?api=1&query=3.0554057%2C101.7005614)
- Bukit Jalil LRT station is approximately `3.0581, 101.6919`. [Station reference](https://www.klia2.info/rail/rapidkl-lrt/ampang-line/bukit-jalil/) · [Google Maps pin](https://www.google.com/maps/search/?api=1&query=3.0581%2C101.6919)

Use a dropped pin at each actual boarding spot for the 30-metre check-in radius. The public references identify the campus and station landmarks.
