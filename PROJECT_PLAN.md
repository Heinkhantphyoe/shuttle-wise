🚌 Project Blueprint: ShuttleWise
Core Pitch Statement
ShuttleWise is a lightweight, zero-hardware web application designed to eliminate the 45-minute APU-to-LRT shuttle queue. It combines crowdsourced location-verified check-ins, a static timetable engine, an AI-powered wait-time predictor, and an instant peer-to-peer "Split a Grab" broadcast system with zero login friction.

📱 Key Features & User Flow
1. Frictionless Public Queue Dashboard
Instant Access: Anyone opens the web app and instantly sees the live queue count, next bus arrival time, and smart-wait timer—zero login, password, or setup required.

2. Location-Verified Tally Beacon ("I Am At The Stop")
Smart Geofence: Students physically at the bus stop click "I am at the Stop".

Anti-Spam Filter: The browser's native Web Geolocation API checks if the user is within a strict radius (e.g., 30 meters) of the actual shuttle stop coordinates.

Live Tally: If verified, it increments the live queue counter in real time.

3. AI-Powered Wait Predictor (Gemini 1.5 Flash)
Smart Estimates: Behind the scenes, Gemini processes the static schedule and live click velocity to output human-friendly, punchy status copy (e.g., "Line is 3 buses deep. Expected wait: ~35 mins").

4. Decentralized "Split a Grab" Broadcast (Guest-Identified)
Host a Ride: A student stuck in line clicks "Host a Grab Split", inputs their destination (e.g., Bukit Jalil LRT), inputs the total estimated fare from their app (e.g., RM18.00), and adds a quick appearance/spot tag (e.g., Red hoodie, near pillar) saved locally for the session.

Live Cloud Alert: Firebase fires a real-time notification banner to all active students on that route.

Instant Join & Auto-Math: Interested students tap "Join", provide a quick nickname/tag, and the app automatically calculates the split per head (e.g., ~RM4.50/pax).

Capacity Lock: The broadcast automatically closes once it hits 4 members.

🛠️ Tech Stack (The Google/Fast Track)
Frontend: React / Next.js (clean mobile-first UI layout).

Backend & State: Firebase Firestore (for real-time queue counts and live broadcast rooms).

Location: Browser Web Geolocation API (zero setup).

AI Engine: Google Gemini 1.5 Flash API (for wait-time text generation and dynamic broadcast notifications).