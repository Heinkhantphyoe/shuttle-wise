# AI travel updates: setup and use

The active Firebase project is now **`shutterbus`** (your project), with a Standard Firestore database in Singapore (`asia-southeast1`). Google and anonymous sign-in are enabled, localhost is authorised, the tested project rules are published, and your Google account is allowlisted as an app admin. `.env`, `.firebaserc` and the Worker Firebase identifiers point to this project.

This is a fresh setup, as requested after the old project denied access. **No old records or Authentication users were copied from `shuttlewise-e77bf`.** That project was not modified. A private configuration rollback backup is under ignored `.firebase/migration-2026-11-11/`; it is not a database backup. Existing users must sign in to the new project. Collections are created by valid app actions rather than empty placeholder records.

## Easiest setup on this computer

Run `npm run dev` from the `shuttle-wise` folder, then open the Local URL printed in the terminal and go to `/admin`. Sign in with an allowlisted Google admin account, choose a direction, enter the update and click **Read with AI**. Restart an already-running dev server once after adding this configuration.

The development server now runs the AI endpoint itself. It reads the existing private key from ignored `worker/.dev.vars`, so no Worker URL or reCAPTCHA site key is needed for this local flow. It reuses the same Gemini extraction, image limits and response validation as the Worker. The key is never included in the browser bundle; the server also blocks requests for `.env`, `.dev.vars` and private `.firebase` backups.

Verified in Dia on 11 November 2026: admin sign-in, real Gemini notice reading, admin briefing, publication and withdrawal worked. The temporary test notices were withdrawn. The unchecked-in student, queue and Grab list loaded without permission errors. Real GPS check-in was rejected at 143-metre reported accuracy; the 50-metre requirement was preserved. Live checked-in host/join remains unverified. Automated results and remaining provider failures are recorded in [the deep test report](output/deep-validation-2026-11-11/RESULTS.md).

This endpoint works only on loopback (`localhost` / `127.0.0.1` / `::1`), requires a matching browser Origin, verifies Firebase sign-in and Google admin allowlisting, and limits each admin to six requests per minute. It supports admin notice reading, numeric-only admin briefing and setup status. Local Firebase emulator mode remains separate and does not use this endpoint. The production build does not include the endpoint or enable local mode; the hosted Worker still requires App Check.

**Read with AI** only prepares a draft. **Publish announcement** still uses the existing Firestore permissions and does not write the standard timetable. If publication or announcement loading says “Missing or insufficient permissions”, the Firebase owner must deploy the matching rules and confirm admin access. The Gemini key cannot grant database permissions. Students receive published changes only while checked in on the affected direction.

## Hosted setup

Real Gemini tests passed on 8 November 2026. The key is saved only in the ignored local `worker/.dev.vars` file. The Worker model is `gemini-3.5-flash-lite`, which successfully read text and a PNG and produced validated student advice.

The local app is connected to your new Firebase project. A public Hosting/Cloudflare deployment has not been performed. The local-only AI endpoint is not part of the production build; use the hosted steps below when publishing the website.

## Remaining steps for the project owner

These steps apply to your own `shutterbus` project. Do not share account passwords.

1. Register web app `1:365071100344:web:91a5dd492698a4deed074d` with **App Check → reCAPTCHA Enterprise**. Allow the actual website domain and add the **public site key** as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
2. Your current Google admin is already allowlisted. Only add other `admins/{firebaseUid}` documents for explicitly authorised Google accounts.
3. Sign in to the Cloudflare account that will own this Worker with `npx wrangler login`. Check `APP_ORIGIN` in `worker/wrangler.jsonc` matches the actual website origin. Deploy the Worker, then run the secret command below and enter the Gemini key privately. Return the Worker URL for `VITE_AI_WORKER_URL`.
4. Add those two public values to `.env.local`, run `npm run build`, and deploy the matching frontend and Firestore rules using the owner's Firebase access. The exact commands are below.
5. At `/admin`, use **Transport announcements → Admin update** to read a real update. Check the published result in a separate student session. This hosted check is still pending. There is no AI setup panel in the dashboard.

You can already repeat the real provider tests on this computer:

```sh
npm run test:ai:live
```

This opt-in command sends public test fixtures to Gemini through the same extraction and advice functions the Worker uses. It writes results to `output/ai-live-validation/results.json`. It does not publish notices or use Firestore records. These API calls use the key's normal quota. See [the verification record](output/ai-live-validation/RESULTS.md).

## 1. Where to add the Gemini API key

Keep the key in **Cloudflare Worker secrets**, never in `.env`, a `VITE_` variable, Firestore, or the browser.

From the `shuttle-wise` folder, use the interactive prompt:

```sh
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.jsonc
```

Enter the key in that prompt. Do not paste it into chat or commit it.

For local Worker development only, copy `worker/.dev.vars.example` to `worker/.dev.vars` and enter the key there. The real file is ignored by Git.

The new travel features use Gemini on the Worker. Local admin history briefing uses the same authenticated local Gemini endpoint. The hosted briefing keeps Firebase AI Logic first and its existing OpenRouter fallback. If you use that fallback, its secret is:

```sh
npx wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.jsonc
```

No new provider or paid service is created automatically.

## 2. Worker and browser settings

Complete these public values in `worker/wrangler.jsonc`:

| Setting | Value |
| --- | --- |
| `APP_ORIGIN` | Exact app origin, such as `https://YOUR_PROJECT.web.app`, without a trailing slash |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PROJECT_NUMBER` | Numeric project number from Firebase project settings |
| `FIREBASE_APP_ID` | The web app's Firebase App ID |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` — verified with this key for text, PNG and structured JSON |

The model name is configurable. `gemini-2.5-flash` returned a provider error for this key; the configured model above passed real generation tests. Model availability and quota can change, so use the opt-in live check when changing it.

Use `.env.example` for browser configuration, and add these values to your ignored `.env.local`:

```dotenv
VITE_AI_WORKER_URL=https://YOUR_WORKER.workers.dev
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=YOUR_PUBLIC_APP_CHECK_SITE_KEY
VITE_GEMINI_MODEL=YOUR_FIREBASE_AI_LOGIC_MODEL
```

`VITE_GEMINI_MODEL` belongs to the existing admin briefing. `GEMINI_MODEL` in the Worker config belongs to the new travel endpoints. They do not contain keys.

Keep the existing Firebase web configuration and confirmed pickup coordinates. Enable anonymous student sign-in and Google admin sign-in. Register the web app with reCAPTCHA Enterprise App Check and allow the deployed app domain. The new Worker endpoints verify the App Check token themselves; enabling it in the browser alone is not enough.

Have the admin sign in at `/admin`. The Firebase project owner must create `admins/{firebaseUid}` for that Google account. If access is denied, the page shows that account's UID. Never allow students to create admin entries.

## 3. Check and deploy when ready

```sh
npm test
npm run build
npm run test:rules
npx wrangler deploy --config worker/wrangler.jsonc
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.jsonc
npx firebase-tools deploy --only firestore:rules,hosting --project shutterbus
```

Deployment is a separate action. Deploy the new Firestore rules with the matching frontend. Keep the existing ride transaction rules; do not make private ride rosters public.

Open **Admin → Transport announcements → Admin update** and read a small real notice to verify the provider connection. Configuration and server failures appear as temporary toast messages, using the student dashboard's feedback style. Setup instructions stay in this file; there is no AI setup panel in the dashboard.

The old briefing uses POST `/`. New endpoints use POST `/ai/notice-extract`, `/ai/journey-advice`, and `/ai/status`. Student advice accepts only route and snapshot identity; the Worker reads permitted Firestore facts using the student's token. Admin extraction and setup status require an allowlisted Google admin.

## 4. Publish a transport update

Use the single **Admin update** form. There is no separate review form and no title or summary to type.

1. Choose **Affected direction**: APU → LRT, LRT → APU, or Both directions.
2. Write one message with the date (or say today), affected departure or time period, delay/change, and reason. You can also attach a JPG/PNG notice. For example: “Today, the 5:10 pm departure will be 40 minutes late because of traffic.” For both directions, explain the affected services in each direction.
3. Click **Read with AI**. AI reads the details and generates the student notice. A short, read-only result appears in the same card, including the affected direction and timing. You do not fill in a student title, summary, or another set of fields.
4. If details are missing or incorrect, edit the original message and read it again. Changing the message, direction, or image clears the old result so it cannot be published accidentally. When the result is correct, click **Publish announcement** in that same card.

A selected direction controls which students receive the change. AI cannot silently switch it to the opposite route. If the message contradicts the selection or does not explain every selected direction, publication is blocked and the admin corrects the original message.

Conflicting notices must be explicitly replaced or corrected. **Edit update** loads the existing facts as a plain message in the same form; read it again before publishing the correction. **Withdraw** removes the temporary effect.

Students see temporary notices and revised times only after checking in on the selected affected direction. Before check-in, after leaving the queue, or when browsing the other direction, they see the standard timetable. Home and Timetable use the same rule. Original and reported revised times appear together. The countdown updates with Malaysia time. A later scheduled bus may operate before a delayed one. An incoming bus delay never automatically changes its opposite-direction return service. If checked-in students cannot load notices, the app labels the displayed times as the standard timetable.

Only reviewed notices are saved through the announcement form. The standard timetable stays in the code, with the official source and effective date. Withdrawal and expiry remove temporary effects without editing that dataset. Passing a scheduled time never removes a student's check-in.

Notices with known affected times now end automatically after the last affected original or revised minute, using Malaysia time. For example, a 5:10 pm bus delayed by 40 minutes stays updated through 5:50 pm and returns to the standard timetable at 5:51 pm. Each direction ends independently. This also applies to older saved notices whose stored expiry was midnight. Unknown delays without a confirmed end keep their stated expiry. Expired notices disappear from students and the admin's active list; their saved records remain in the admin's expired history.

The admin announcement form has no bus-capacity, fare-range, rush-hour, or source-setting inputs. UI fares use RM; stored ride fares remain integer sen. The next-departure countdown works from the standard timetable and confirmed notices without this configuration.

If AI is not configured or fails, the written message stays in the form for retry. No guessed schedule change is published. Existing notices, withdrawal, and calculated student travel options still work.

## 5. Local demo without an API key

Install Node 22.12+, Java, and Firebase CLI. Start the app with the Auth and Firestore emulators:

```sh
npm run dev:local
```

In a second terminal:

```sh
npm run demo:reset
```

This resets **only** local Firestore project `demo-shuttlewise` on `127.0.0.1:8080`. It creates 40 labelled sample check-ins per direction, capacity 24, and rooms with RM18/RM22/RM25 total fares. It never connects to production. Resetting clears local notices too.

For local admin access, use the Auth emulator's Google sign-in at `/admin`, then copy the UID shown by the page:

```sh
npm run demo:reset -- YOUR_LOCAL_ADMIN_UID
```

Use a browser geolocation override at the configured pickup to test check-in away from the stop. The demo still follows the real Malaysia weekday/time; on weekends it correctly shows no standard service. The unit tests cover a fixed weekday afternoon and position 41 with capacity 24.

Open student and admin in separate tabs to inspect the form and sample travel comparison. Local emulator notices are visibly labelled **DEMO**. Gemini is deliberately disabled in emulator mode, so reading and publishing a new AI notice needs the configured real environment after adding your key. The automated browser checks use clearly identified mocked extraction responses to verify the complete single-form flow; that is not a live Gemini test.

If AI fails, the message stays available for retry and existing calculated options still work. If Firestore data fails, the app says it is unavailable rather than claiming there are no notices or no rooms.

## Official references

- [APU standard timetable, effective 22 October 2026](https://publicwebsite-media.apu.edu.my/assets/2026-10/2026Oct22_APU-SHUTTLE-SERVICES.pdf)
- [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [App Check verification on a custom backend](https://firebase.google.com/docs/app-check/custom-resource-backend)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
