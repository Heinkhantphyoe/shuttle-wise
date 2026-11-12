# Temporary Savanna testing — 12 November 2026

Production: https://shuttle-wise.vercel.app

## Active configuration

Both APU and LRT route check-ins now use the separate Savanna Bukit Jalil test point: `3.0562257, 101.687699`. The Google Maps place details identify this as Savanna Bukit Jalil (place ID `ChIJ9-pxWZRKzDER6d6_eSGxdAk`). The supplied share link opens a search for that place.

The original coordinate variables were not changed, locally or in Vercel Production:

- APU: `3.055070, 101.700573`
- Bukit Jalil LRT: `3.058372, 101.691650`

`VITE_PICKUP_PROFILE=savanna` selects the temporary point. `VITE_PICKUP_PROFILE=original` restores both original points after local restart / production redeployment. Savanna has its own two coordinate variables. An invalid temporary configuration disables check-in instead of falling back to a different point. The radius and GPS accuracy threshold remain 50 metres.

The app displays a temporary-testing notice. Sample ride cards are labelled. Route names and timetables were not renamed or changed.

## Intentionally retained sample data

The user asked to keep temporary samples until they want to switch back:

- 30 sample check-ins: 15 APU and 15 LRT, including the hosts and sample ride members.
- 6 sample open rides: 3 in each direction.
- Each direction has RM18, RM20 and RM24 total fares, with 1, 2 and 3 members respectively.
- 84 new documents in total: 30 activity, 30 history, 6 rides, 6 rideListings and 12 rideMemberships.
- Sample IDs start with `sample-savanna-20261112-`.
- The existing history document was preserved with the same update time. No existing records, admin settings, travel settings, rules or Firebase Auth accounts were changed. No new Auth accounts were needed for the synthetic records.
- These are sample records, not real people or bookings.

Normal local development and production share the `shutterbus` Firebase database. One sample set is visible in both.

The ignored `.firebase/savanna-demo-2026-11-12/` directory contains the private pre-seed snapshot, the exact 84-document manifest, and `manage-samples.mjs`. It can inspect or remove only these recorded sample IDs. Removal refuses changed samples (for example, if a real tester has joined a sample ride) so those cases can be reviewed. No database-wide reset was run.

## Validation

- Production build passed; existing large-bundle warning remains.
- 42/42 tests passed, including temporary point selection, preservation of original coordinates, restoration, and invalid configuration handling.
- Loaded local Vite settings: both active points are Savanna; both saved originals match the values above.
- Vercel Production environment was read back: new profile and Savanna coordinates are correct; all four original coordinate variables are unchanged.
- Seed verification read back all 84 documents and checked that existing data stayed unchanged.
- Dia local student page displays the Savanna notice and 15 waiting students. All six sample ride cards load with expected fares, member counts and sample labels.
- Dia production student page displays the Savanna notice, 15 waiting students on each route, and all six labelled sample rides. Join stays disabled before check-in.
- No location override or test check-in was performed on production. Real-device GPS accuracy and successful check-in at the Savanna pin still depend on the device's actual location.
- Public `/` and `/admin`: HTTP 200. Private paths: 404. Unsigned AI request: 401.
- Deployed JavaScript contains the active Savanna profile, separate coordinates, saved original coordinates and sample labels.
- Vercel runtime error scan: none in the selected 15-minute window.

## Release

Source commit `8a93f5e` was pushed to main. Production deployment `dpl_3552jWkr476cvdHsBJ9R1HU58Gmp` is READY and serves `shuttle-wise.vercel.app`. Build time was about 55 seconds. The production update uses the existing project and settings; only the three new location variables were added.

The existing unrelated modifications to AGENTS.md and tests/local-ai.test.mjs, plus other untracked workspace files, were left alone. Local screenshots and the private seed-management files are not uploaded to production or committed to the public repository.

## Exact pin correction — 12 November 2026

The user supplied a screenshot with **3.056444, 101.687690**. Both temporary pickup points now use these exact coordinates instead of the earlier public place pin. Original APU/LRT variables and all 84 sample documents were left unchanged. Local build and all 42 tests pass.
