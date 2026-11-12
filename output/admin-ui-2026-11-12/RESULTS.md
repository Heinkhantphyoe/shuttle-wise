# Admin notice UI update — 12 November 2026

Production: https://shuttle-wise.vercel.app/admin

## Changes

- Renamed “Read with AI” to “Create notice preview”.
- Added a short three-step guide: add details, create a preview, publish.
- Added guidance below the buttons explaining missing input and that publication is a separate step.
- Replaced the native direction popup with a styled, labelled combobox. Supports pointer selection, arrows, Home/End, Enter/Space, Escape, Tab, and initial-letter matching. The selected route has a checkmark. Choices scroll into view on small screens.
- Updated correction messages and AI_SETUP.md to use the new button name.
- Used the repository's ui-ux-pro-max skill and React review guidance. No dependencies added.

## Validation

- npm run build: passed. Existing bundle-size warning remains.
- npm test: 39/39 passed. The initial sandbox run could not bind local test servers; the permitted run passed.
- git diff --check: passed.
- Actual local admin form checked in Dia at desktop size and in 375 px portrait / 812 px landscape iframe viewports.
- Local isolated dropdown check: click selection, arrow selection, Escape preserving selection, outside dismissal, disabled state, and reset passed.
- Local full form: direction/message input enables preview; Clear resets the form and disables preview.
- Signed-in production admin checked in Dia: new guide and controls load, live queues load, and a real AI preview returns 13 November 2026, APU → Bukit Jalil LRT, 5:10 pm, 40 minutes late due to heavy traffic, expiry at 5:51 pm.
- No test announcement was published and no queue/ride/history records were created or removed. The normal AI quota counter may be updated by the preview request.
- Public root and admin return HTTP 200. Deployed JavaScript includes the new labels and dropdown, with no “Read with AI” label.
- Private environment and backup paths return HTTP 404. An unsigned AI request returns HTTP 401.
- Vercel runtime error scan: no errors in the selected 15-minute window.

Screenshots are kept locally in this directory; desktop browser chrome is not included in the public Git commit.

## Release

- Existing deployed timetable source was checked against the previous deployment's SHA1 file identifiers. The schedule, journey calculation, student view, and travel contract match the already-live version exactly.
- c7f6b99: sync that previously deployed timetable correction to GitHub.
- 216e3a7: admin UI update, pushed to main.
- Production deployment: dpl_FDKBvWFfyrDcj7GqLM5N79ghhBx2, READY, serving shuttle-wise.vercel.app.
- Vercel build duration: about 65 seconds.
- Existing unrelated edits to AGENTS.md and tests/local-ai.test.mjs were preserved locally.
