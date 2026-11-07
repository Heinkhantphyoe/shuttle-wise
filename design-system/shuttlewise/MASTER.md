# ShuttleWise student design system

The UI/UX Pro Max generator returned Minimalism & Swiss Style for both a mobile transit utility and a public transit commuter dashboard. Keep its functional grid, whitespace, crisp typography, and restrained motion. The student app is a React web interface for commuters making quick decisions at a stop. Its first screen prioritizes the selected route, next scheduled departure, and current queue action. Indigo and a single sans-serif family follow the project brief.

## Theme tokens

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#F4F6FB` | `#0B1220` |
| Surface and navigation | `#FFFFFF` | `#151F32` |
| Text | `#0F172A` | `#F1F5F9` |
| Supporting text | `#475569` | `#AAB8CF` |
| Accent and focus ring | `#4338CA` | `#A5B4FC` |
| Text on accent | `#FFFFFF` | `#0B1220` |
| Input outline | `#64748B` | `#71829D` |
| Danger text | `#B91C1C` | `#FDA4AF` |

Default to Light. Use a sun-and-moon button in the header to toggle between Light and Dark and persist the preference. Resolve the theme before first paint. Apply semantic tokens and native `color-scheme` to the student canvas, controls, navigation, dialogs, and feedback surfaces.

Primary text on canvas measures 16.51:1 in light and 17.09:1 in dark. Supporting text on surface measures 7.58:1 and 8.22:1. Primary button labels measure 7.90:1 and 9.39:1. Input outlines on surface measure 4.76:1 and 4.22:1. These ratios describe the proposed solid pairs. Verify rendered states, borders, and scrims in both themes during implementation.

## Type, spacing, and interaction

- Use Inter with a system sans-serif fallback. Use tabular numerals for departures, fare estimates, and counts. Set sizes in rem and allow wrapping.
- Departure display 40/44 at 700. H1 32/38 at 700. H2 24/30 at 650. H3 18/24 at 650. Body and inputs 16/24 at 400. Labels 14/20 at 600. Captions 12/16 at 500. Values are in CSS pixels at the default root size.
- Use 16px gutters on narrow phones, 20px at typical phone widths, and 24px on wider layouts. Use a 4px spacing grid, 24–32px between sections, 16px card corners, and 10px input corners.
- Give every student control a minimum 48×48 CSS px interactive box and use at least 8px between adjacent targets. Keep visible focus outlines and reserve scroll clearance above sticky UI.
- Use a sticky, inset bottom bar with Home, Timetable, and Share a Grab. Pair consistent outline icons with visible labels and a selected pill. Give each destination a URL and preserve route selection and screen state on Back. Keep the bar above the device safe area.
- Use a 100ms press response and a 160ms selection transition with opacity or transform. Reduced motion resolves both immediately. Keep animation independent of navigation state.
- Use floating labels that stay visible when focused or filled. Keep input text at 16px or larger, connect inline errors to the field, and show submission progress. Put feedback near the action and announce important changes without taking focus.

## Screen hierarchy

| Screen | Primary content | Supporting content |
| --- | --- | --- |
| Home | Route, next scheduled departure, check-in or current queue action | Location recovery, queue count, find a Grab share |
| Timetable | Route, service day in Malaysia time, list with next departure marked | Closed-service and next-weekday states |
| Share a Grab | Current group when joined, otherwise available rides with seats and estimated cost per person | Host form, pickup eligibility, fare changes, and confirmation or recovery states |

Keep timetable availability separate from live queue availability. Use the live app's confirmation copy and transaction behavior as the source for how joining or hosting affects the queue. Verify location denial, offline or unavailable Firebase, no scheduled service, empty and full ride lists, fare changes, and pending actions. Check portrait and landscape at small widths, text enlargement, keyboard focus, reduced motion, and both themes.
