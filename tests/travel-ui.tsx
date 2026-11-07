// Browser regression fixtures only. Not a production entry point; no writes or AI calls.
import { createRoot } from 'react-dom/client'
import { compareJourney } from '../src/journey'
import { timeOn } from '../src/schedule'
import { NextDeparture, TravelTimetable } from '../src/travel-student'
import '../src/style.css'
import '../src/student.css'

const date = '2026-11-06'
const now = timeOn('2026-11-07', '00:10')
const comparison = compareJourney({ route: 'apu', now, uid: 'fixture', queue: [], rooms: [], notices: [{
  id: 'overnight', status: 'published', version: 1, demo: false, title: 'Late Friday departure', summary: 'The last Friday departure is delayed.',
  reason: 'Traffic', sourceLabel: 'Public test fixture', sourceExcerpt: '', sourceUrl: '', serviceDate: date,
  visibleFrom: timeOn(date, '20:00'), expiresAt: timeOn('2026-11-07', '01:00'), updatedAt: timeOn(date, '20:00'),
  changes: [{ route: 'apu', type: 'delay', departures: ['21:45'], delayMinutes: 180, revisedTime: null, start: null, end: null, capacity: null, pickup: '' }],
}] })
const morning = timeOn('2026-11-09', '08:00')
const continuous = compareJourney({ route: 'lrt', now: morning, uid: 'fixture', queue: [], rooms: [], notices: [] })

createRoot(document.getElementById('root')!).render(<main className="app student-app">
  <h1>Local regression fixtures</h1><p>Artificial dates and notices. No real users or service changes.</p>
  <section data-testid="overnight"><h2>Friday delay continuing into Saturday</h2>
    <NextDeparture comparison={comparison} now={now} /><TravelTimetable comparison={comparison} now={now} />
  </section>
  <section data-testid="continuous"><h2>Continuous morning service</h2>
    <NextDeparture comparison={continuous} now={morning} /><TravelTimetable comparison={continuous} now={morning} />
  </section>
</main>)
