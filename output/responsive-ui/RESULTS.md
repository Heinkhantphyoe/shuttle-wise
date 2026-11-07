# Responsive UI checks

Checked locally on 8 November 2026 using the Auth and Firestore emulators and labelled demo data. AI extraction was mocked for the browser workflow; no live Gemini request or deployment was performed.

The route-capacity, fare-range, rush-hour, and source-setting forms were subsequently removed at the user’s request. The current admin interface has a single announcement form and an AI setup check. Earlier screenshots show the layout before that removal.

## Layout changes

- Kept one admin announcement form. The direction, message, image input, and AI result remain together.
- Put the form and published announcements in two columns at desktop widths and one column on smaller screens.
- Matched the admin colours to the existing indigo student design, with clearer headings, sections, queue counts, spacing, and file controls.
- Made controls fit their columns, with 48px admin touch targets and wrapping text.
- Expanded the student layout on larger screens. Shuttle and Grab options sit side by side from 640px; check-in and Grab actions sit side by side from 768px.
- Kept phone views stacked, student navigation reachable, and timetable text readable.

## Browser results

Passed for admin and student screens at 320×740, 390×844, 600×900, 768×1024, 1024×768, 1440×1000, 1920×1080, and 844×390.

- No document-wide horizontal overflow or form controls outside the viewport.
- Correct one/two-column layouts at the selected breakpoints.
- 200% text size at 320px reflows for both screens.
- Light/dark student views and reduced motion checked.
- Timetable checked at 320px, 768px, and 1440px.
- Keyboard focus remains visible when moving through the form.
- No browser runtime errors in the complete test flow.

The existing one-form workflow also passed: generated preview, real local publication, direction isolation, both-direction correction, clearing stale results after edits, missing-detail handling, AI-failure retry, and withdrawal.

## Screenshots

- [Admin desktop](admin-desktop.png)
- [Admin mobile](admin-mobile.png)
- [Student desktop](student-desktop.png)
- [Student mobile](student-mobile.png)
- [Student dark tablet](student-dark-tablet.png)
