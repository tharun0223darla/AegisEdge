# AegisEdge (QualShield AI)
> **On-Device Edge-AI Environmental Health Companion & Zero-Grid Disaster Survival Beacon**  
> *Smart India Hackathon 2026 (SIH 2026) | Problem Statement: SIH26181 (Qualcomm Inc.)*  
> **Team medi_nexus (Team ID: 147870)**

[![Wokwi Simulation](https://img.shields.io/badge/Wokwi-Live%20Simulation-brightgreen)](https://wokwi.com/projects/476318694941014017)
[![Hardware Edition](https://img.shields.io/badge/Category-Hardware%20Edition-blue)](https://sih.gov.in)
[![Target Silicon](https://img.shields.io/badge/Qualcomm-Snapdragon%20W5%2B%20%7C%20Hexagon%20NPU-purple)](https://aihub.qualcomm.com)

---

## 📌 Problem Overview
During extreme climate events in India (heatwaves >45°C, toxic PM2.5 smog >400 µg/m³, and monsoonal flash floods), vulnerable outdoor workers and rural citizens face acute risks of heatstroke, severe bronchospasm, and sudden cardiac decompensation. Traditional wearables fail during climate disasters when cellular towers blackout and power grids collapse.

**AegisEdge** delivers:
1. **Multimodal Edge Sensing:** MAX30102 PPG vitals, Bosch BME688 microclimate telemetry, Sensirion SPS30 laser PM2.5 optical chamber, and capacitive flood contacts.
2. **On-Device TinyML & Physics Models:** Real-time ISO 7243 Wet Bulb Globe Temperature (WBGT) computation, IMU-referenced NLMS motion artifact cancellation, and INT8 TCN running in <64KB SRAM with <12ms latency.
3. **Zero-Grid LoRa Mesh (IN865):** Autonomous failover to India's de-licensed 865–867 MHz LoRa mesh (up to 10 km range) broadcasting 32-byte START triage packets to disaster rescue teams (NDRF/SDRF) alongside an 85 dB acoustic siren.
4. **Realistic Autonomy & BOM:** Duty-cycled 48–72h battery life on a 350 mAh cell, with a prototype BOM under ₹1,500 (<₹900 at 10,000 units).

---

## 🛠️ System Architecture

```
+----------------------------------------------------------------------------+
|                       AEGISEDGE HARDWARE COMPANION                         |
|                                                                            |
|  [MAX30102 PPG]     [BME688 Climate]     [SPS30 PM2.5]   [Submersion Pins] |
|        |                   |                   |                 |         |
|        +-------------------+-------------------+-----------------+         |
|                            | I2C / Analog / GPIO                           |
|                            v                                               |
|               +----------------------------+                               |
|               | ESP32-S3 / Qualcomm W5+    |                               |
|               | - NLMS Motion Cancellation |                               |
|               | - ISO 7243 WBGT Math       |                               |
|               | - INT8 TCN Smog Predictor  |                               |
|               +----------------------------+                               |
|                     |                |                                     |
|           (BLE 5.3) |                | (865-867 MHz LoRa Mesh)             |
|                     v                v                                     |
|           +-----------------+   +--------------------------+               |
|           | MediTrack Web   |   | NDRF/SDRF Disaster Triage|               |
|           | Companion PWA   |   | 32-Byte Packed SOS Stream|               |
|           +-----------------+   +--------------------------+               |
+----------------------------------------------------------------------------+
```

---

## 🧪 Interactive Live Simulation

You can test and inspect the full AegisEdge firmware and hardware simulation online:
👉 **[Launch Live Wokwi Simulation](https://wokwi.com/projects/476318694941014017)**

The virtual simulation models:
- Real-time **SSD1306 OLED** graphical telemetry display
- **DHT22** sensor driving on-device ISO 7243 WBGT thermal calculations
- **Potentiometer inputs** simulating laser PM2.5 spikes and SpO2 variations
- **Red Emergency Button** simulating flash flood capacitive contacts
- **Piezo buzzer** driving the local 85 dB acoustic alarm
- **Serial telemetry** streaming 32-byte START triage binary JSON frames

---

## 💻 MediTrack AI Companion Web & API Suite

This repository also includes the complete **MediTrack AI** clinical web application and backend:
- **Frontend (`apps/web`):** React 18 + Vite, TailwindCSS, Lucide icons, Leaflet GIS trauma mapping, and audio alert engines.
- **Backend (`src/`):** NestJS 11, Prisma ORM, PostgreSQL, CDSCO medication intelligence, NEWS2 predictive decompensation engine, and automated SOS dispatch handlers.

### Quick Start (Local Setup)

```bash
# 1. Install dependencies
npm install

# 2. Run backend API (port 3001)
npm run start:dev

# 3. In another terminal, run frontend (port 5173)
cd apps/web
npm run dev
```

---

## 📂 Repository Structure

```
├── firmware/
│   └── wokwi/              # Wokwi simulation source (sketch.ino, diagram.json)
├── apps/
│   └── web/                # React 18 MediTrack dashboard & Leaflet trauma map
├── src/                    # NestJS backend API & clinical prediction modules
├── prisma/                 # Database schema & migrations
├── AegisEdge_SIH26181_Winning_Presentation.pptx # Official pitch deck
└── README.md
```

---

## 📜 Standards & Compliance
- **ISO 7243:2017:** Ergonomics of the thermal environment — Assessment of heat stress using WBGT index.
- **DoT India Wireless Regulations:** 865–867 MHz (IN865) license-free ISM band compliance.
- **START Triage Protocol:** Simple Triage and Rapid Treatment color codes (Red, Yellow, Green, Black).
- **ABDM / FHIR:** Telemetry schemas conform to Ayushman Bharat Digital Mission guidelines.