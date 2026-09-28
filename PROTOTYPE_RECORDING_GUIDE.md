# 🎬 MediTrack AI — Prototype Video Recording Guide & Storyboard

> **Target Duration:** ~4 Minutes 50 Seconds  
> **Platform URL:** http://localhost:5173/  
> **Demo Account:** `darlaparvathi01@gmail.com` / `Password123!`

---

## 🛠️ Quick Pre-Recording Setup (60 Seconds)

1. **Start the Servers (if not running):**
   - Backend: `http://localhost:3001`
   - Frontend: `http://localhost:5173`
2. **Browser Settings:**
   - Open Chrome or Edge to `http://localhost:5173/`.
   - Log in using `darlaparvathi01@gmail.com` and `Password123!`.
   - Press **`F11`** to enter full-screen mode (hides address bar and bookmarks).
   - Zoom level: **100%**.
3. **Audio Settings:**
   - Set laptop speaker volume to **60%–70%** so your screen recorder captures the audio sirens and success chimes.
4. **Recording Tool (Choose ONE):**
   - **Windows Built-in (Easiest):** Press **`Win + Alt + R`** (or `Win + G`).
   - **OBS Studio:** Full-screen Display Capture + Desktop Audio.
   - **Loom / Clipchamp:** Screen + Webcam bubble in the corner.

---

## ⏱️ Video Timing Summary Table

| Scene | Feature | Duration | Key Action & Visual Anchor |
| :---: | :--- | :---: | :--- |
| **1** | Dashboard & Schedule | `0:30` | Hover top green banner & pending dose badge (`SazO 500`) |
| **2** | Optical Strip Verifier | `1:15` | Wrong pill buzzer ➔ CDSCO expiry lockout ➔ Authentic pass |
| **3** | Predictive NEWS2 Vitals | `0:40` | Simulate acute shock risk (score jumps from 0 to 9) |
| **4** | Autonomous 0-Click SOS | `0:45` | Liveness countdown siren & automatic dispatch modal |
| **5** | Hospital Trauma Map | `0:35` | Filter emergency facilities & Leaflet map pins with hotlines |
| **6** | Ambulance & EMT Handover | `0:40` | Live vehicle tracking map + pre-loaded medication dossier |
| **7** | Care Circle & Closing | `0:25` | Caregiver escalation status & return to clean dashboard |
| **Total** | **Complete Prototype** | **~4m 50s** | **Ready for voiceover synchronization** |

---

## 🎬 Step-by-Step Recording Actions (Follow In Sequence)

---

### **SCENE 1: Dashboard Command Center & Prescribed Schedule**
* **URL:** `http://localhost:5173/dashboard`
* **Duration:** `0:00 – 0:30` (30 seconds)
* **Mouse Actions:**
  1. Move mouse slowly across the top green banner: *"Ready for Intake: SazO 500 — Point-of-Care CDSCO & GS1 Strip Verifier Available"*.
  2. Scroll down smoothly to the **"Today's Schedule / Upcoming Doses"** card.
  3. Hover over the badge showing **`SazO 500 at 06:00 PM (PENDING)`**.
  4. Move cursor to the green button: **`[Scan Strip with Camera]`** and hold still for 2 seconds.
* **Voiceover Script (To record later):**
  > *"Every day, over 300 million patients rely on generic reminder apps. But reminders only ping the patient — they blindly trust that the right pill was taken. Look-Alike, Sound-Alike medication errors kill one person every five minutes worldwide.*
  > 
  > *Welcome to MediTrack AI — the world’s first Zero-Trust, Point-of-Care medication safety platform powered by computer vision and CDSCO regulatory intelligence."*

---

### **SCENE 2: The Core Innovation — Point-of-Care Blister Strip Verifier**
* **URL:** Modal overlay on `/dashboard`
* **Duration:** `0:30 – 1:45` (75 seconds)
* **Mouse Actions:**
  1. Click **`[Scan Strip with Camera]`** to open the modal. The live camera preview appears.
  2. **Part A: Intercepting Wrong Medicine (Buzzer):**
     - Click the collapsible bar: **`🧪 Test Real OCR Text Input`** (or hold up a wrong medicine to your webcam).
     - Type: `Atorvastatin 20mg` and click **`Verify Custom Text`**.
     - **Buzzer sounds!** The screen bounces into:  
       `🚨 WRONG MEDICINE / MISMATCH INTERCEPTED! Ingestion Locked.`
     - Hover over the *"Clinical Intercept Reason"* for 3 seconds.
  3. **Part B: Regulatory Expiry Lockout (CDSCO Compliance):**
     - Click **`Rescan Correct Strip`**.
     - In the test input, type: `BATCH SAZ-991 EXP 01/2024` and click verify.
     - The amber card appears: `⛔ CDSCO SAFETY LOCKOUT: Expired SazO 500 Detected`. Pause 3 seconds.
  4. **Part C: Authentic Verification & Intake Confirmation:**
     - Click **`Scan Fresh Strip`**.
     - Click the preset button **`[Simulate Authentic Match]`** (or hold your real `SazO 500` strip and click `[📸 Capture from Camera]`).
     - **Chime sounds!** The emerald green card appears:  
       `✅ CDSCO & GS1 PASS: Authentic SazO 500 Confirmed!`
     - Click the green **`[Confirm & Mark Taken]`** button.
     - The modal closes. The dashboard dose badge immediately flips from yellow `PENDING` to green **`TAKEN`**.
* **Voiceover Script:**
  > *"Notice what happens when a patient accidentally picks up the wrong strip. Within 400 milliseconds, our contrast-normalized edge OCR intercepts the error. An audible siren sounds, ingestion is locked, and an adverse event is logged in the safety trail.*
  > 
  > *Next, our CDSCO engine inspects regulatory batch integrity: expired or recalled strips are immediately locked out.*
  > 
  > *Only when the authentic strip is optically verified does the system unlock ingestion, recording closed-loop telemetry directly into the clinical database."*

---

### **SCENE 3: Predictive Decompensation Engine (NEWS2 Clinical Score)**
* **URL:** `http://localhost:5173/dashboard`
* **Duration:** `1:45 – 2:25` (40 seconds)
* **Mouse Actions:**
  1. Scroll down to the **"Predictive Decompensation Engine (NEWS2)"** card.
  2. Hover across the physiological tiles: *SpO2 (98%), BP (120/80), Heart Rate (72 bpm), Respiration (16/min)*.
  3. Notice the baseline score: **`NORMAL (Score: 0)`**.
  4. Click the red simulation button: **`[Simulate: Acute Shock Risk]`**.
  5. The card turns dark red, the dial surges to **`SCORE = 9 (CRITICAL)`**, acoustic alert sounds, and a toast fires: *"🚨 NEWS2 CRITICAL ALERT: Imminent shock risk detected!"*
  6. Pause on this red card for 4 seconds.
* **Voiceover Script:**
  > *"Post-ingestion safety is equally vital. While commercial wearables show simple step counts, MediTrack AI incorporates the Royal College of Physicians' NEWS2 protocol.*
  > 
  > *By aggregating multi-parameter biometrics, the platform detects acute physiological decline — such as septic shock or severe hypoxia — hours before cardiac collapse, automatically triggering clinical escalation."*

---

### **SCENE 4: Autonomous "Zero-Click" Emergency SOS**
* **URL:** `http://localhost:5173/emergency`
* **Duration:** `2:25 – 3:10` (45 seconds)
* **Mouse Actions:**
  1. Click **`Emergency SOS`** in the top navigation bar.
  2. Scroll gently through emergency categories (*Cardiac, Trauma, Hypoxia*).
  3. Click the button: **`[⚡ Trigger Autonomous SOS Simulation]`**.
  4. In the modal, select **`SpO2 Crash (<80%)`**.
  5. The **30-Second Liveness Countdown** starts ticking down (`30... 29... 28...`) with an audible siren.
  6. Let it tick for 6 seconds to show the autonomous fail-safe in action.
  7. Click **`[I Am Safe - Cancel Alarm]`** (or dismiss).
* **Voiceover Script:**
  > *"If a patient collapses from an acute stroke or fall and is unable to press a button, traditional panic buttons fail. MediTrack AI features Autonomous Zero-Click SOS.*
  > 
  > *Upon detecting an acute biometric crash, the platform initiates a 30-second acoustic liveness countdown. If the patient is unresponsive, emergency services and the family care circle are dispatched autonomously with real-time GPS coordinates."*

---

### **SCENE 5: Geo-Spatial Hospital & Trauma Center Discovery**
* **URL:** `http://localhost:5173/hospitals`
* **Duration:** `3:10 – 3:45` (35 seconds)
* **Mouse Actions:**
  1. Click **`Hospitals`** in the top navigation bar.
  2. The interactive Leaflet map renders with facilities around current GPS coordinates.
  3. Click the filter tab: **`Emergency Centers`**.
  4. Click on the first hospital card (*Apollo Emergency & Trauma Center*).
  5. The map centers on that hospital pin. Hover over the **ICU Beds capability**, **Distance: 1.8 km**, and the **`[Call Hotline]`** button. Pause 3 seconds.
* **Voiceover Script:**
  > *"During an emergency, transit to the wrong facility is fatal. Our Geo-Spatial Engine filters specifically for accredited 24x7 trauma centers and emergency capabilities, ensuring the patient is routed to the nearest qualified facility immediately."*

---

### **SCENE 6: Live Ambulance Dispatch & EMT Clinical Handover Dossier**
* **URL:** `http://localhost:5173/ambulance`
* **Duration:** `3:45 – 4:25` (40 seconds)
* **Mouse Actions:**
  1. Navigate to the ambulance tracking view.
  2. Show the live vehicle moving on the map with real-time ETA (`6 mins`).
  3. Scroll down to highlight the **"EMT Clinical Handover Dossier"** section.
  4. Slowly hover over the pre-loaded fields:
     - **Verified Active Medications:** `SazO 500mg, HCQS 200mg`
     - **Known Drug Allergies:** `Penicillin (Severe Anaphylaxis)`
     - **Latest NEWS2 Biometrics:** `Heart Rate: 110, SpO2: 88%`
* **Voiceover Script:**
  > *"Here is our critical Golden Hour breakthrough:*
  > 
  > *While the ambulance is in transit, paramedics receive the patient's pre-loaded Clinical Handover Dossier on their tablet before arriving at the home. They know the patient's verified medication intake, active drug allergies, and physiological biometrics — cutting emergency triage time in half."*

---

### **SCENE 7: Care Circle Oversight & Closing**
* **URL:** `http://localhost:5173/care` ➔ `http://localhost:5173/dashboard`
* **Duration:** `4:25 – 4:50` (25 seconds)
* **Mouse Actions:**
  1. Click **`Care Circle`** to show the linked caregiver escalation status.
  2. Click **`Dashboard`** to return to the clean clinical command center view for the final closing shot.
  3. Press **`Win + Alt + R`** to stop your recording.
* **Voiceover Script:**
  > *"In summary: Existing health apps give patients passive reminders. MediTrack AI gives them verification, predictive monitoring, and autonomous emergency protection.*
  > 
  > *Zero proprietary hardware. Zero-trust clinical safety. Thank you."*

---

## 💾 Where Your Video Is Saved on Windows
- If you used **`Win + Alt + R`**:  
  Go to: `C:\Users\tharu\Videos\Captures` (File will be an `.mp4`).
- You can now open Clipchamp, CapCut, or Canva, import your screen video, and record your voice reading the script!
