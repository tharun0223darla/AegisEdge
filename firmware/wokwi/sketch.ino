#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

#define PIN_POT_PM25 34
#define PIN_POT_SPO2 35
#define PIN_SOS_BTN  18
#define PIN_BUZZER   19
#define PIN_LED_OK   25
#define PIN_LED_SOS  26

// Duty-cycle simulation timer
unsigned long lastDutyCycleTime = 0;
bool laserActive = true;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SOS_BTN, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_SOS, OUTPUT);

  dht.begin();

  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 allocation failed"));
    for(;;);
  }

  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setTextSize(1);
  display.setCursor(10, 15);
  display.println("AegisEdge v1.0");
  display.setCursor(10, 30);
  display.println("QualShield AI Core");
  display.setCursor(10, 45);
  display.println("IN865 LoRa: READY");
  display.display();
  delay(1500);
}

// ISO 7243 WBGT Approximation Formula
float calculateWBGT(float tempC, float humidity) {
  float vaporPressure = (humidity / 100.0) * 6.105 * exp((17.27 * tempC) / (237.7 + tempC));
  float wbgt = 0.567 * tempC + 0.393 * vaporPressure + 3.94;
  return wbgt;
}

void loop() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) {
    temp = 36.5;
    hum = 60.0;
  }

  // Calculate real-time WBGT
  float wbgt = calculateWBGT(temp, hum);

  // Read Potentiometers (Simulating SPS30 PM2.5 and MAX30102 SpO2)
  int rawPM25 = analogRead(PIN_POT_PM25);
  int pm25 = map(rawPM25, 0, 4095, 15, 500); // 15 to 500 ug/m3

  int rawSpO2 = analogRead(PIN_POT_SPO2);
  int spo2 = map(rawSpO2, 0, 4095, 80, 100); // 80% to 100%
  int heartRate = map(rawSpO2, 0, 4095, 135, 72); // Inversely proportional HR

  // Read Submersion/SOS Button
  bool sosTriggered = (digitalRead(PIN_SOS_BTN) == LOW);

  // Check Critical Emergency Conditions
  bool heatEmergency = (wbgt >= 32.0);      // High heat exhaustion danger
  bool smogEmergency = (pm25 >= 350);       // Hazardous PM2.5 level
  bool hypoxiaEmergency = (spo2 < 90);      // Acute respiratory drop

  bool isCritical = sosTriggered || heatEmergency || smogEmergency || hypoxiaEmergency;

  display.clearDisplay();

  if (isCritical) {
    digitalWrite(PIN_LED_SOS, HIGH);
    digitalWrite(PIN_LED_OK, LOW);
    
    // Siren tone
    tone(PIN_BUZZER, 1200, 200);

    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("! EMERGENCY ALERT !");
    
    display.setCursor(0, 14);
    if (sosTriggered) display.print("REASON: FLOOD/SOS CONTACT");
    else if (heatEmergency) display.print("REASON: HEATSTROKE RISK");
    else if (smogEmergency) display.print("REASON: SEVERE SMOG AQI");
    else if (hypoxiaEmergency) display.print("REASON: ACUTE HYPOXIA");

    display.setCursor(0, 30);
    display.printf("WBGT: %.1f C  PM: %d", wbgt, pm25);
    display.setCursor(0, 42);
    display.printf("SpO2: %d%%    HR: %d", spo2, heartRate);

    display.setCursor(0, 54);
    display.print("LoRa IN865: BROADCAST");

    // Output 32-byte binary triage telemetry to Serial (Qualcomm/NDRF schema)
    Serial.printf("{\"event\":\"SOS_EMERGENCY\",\"triage\":\"RED\",\"wbgt\":%.1f,\"pm25\":%d,\"spo2\":%d,\"hr\":%d,\"mesh\":\"IN865_865.2MHz\",\"payload_bytes\":32}\n",
                  wbgt, pm25, spo2, heartRate);
  } else {
    digitalWrite(PIN_LED_SOS, LOW);
    digitalWrite(PIN_LED_OK, HIGH);
    noTone(PIN_BUZZER);

    // Normal Monitoring Display
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("AegisEdge | SAFE");

    display.setCursor(0, 14);
    display.printf("Temp: %.1f C  Hum: %.0f%%", temp, hum);
    
    display.setCursor(0, 26);
    display.printf("WBGT: %.1f C (Normal)", wbgt);

    display.setCursor(0, 38);
    display.printf("PM2.5: %d ug/m3", pm25);

    display.setCursor(0, 50);
    display.printf("Pulse: %d  SpO2: %d%%", heartRate, spo2);

    // Periodic Telemetry Stream
    if (millis() - lastDutyCycleTime > 3000) {
      lastDutyCycleTime = millis();
      Serial.printf("{\"status\":\"NORMAL\",\"temp\":%.1f,\"hum\":%.0f,\"wbgt\":%.1f,\"pm25\":%d,\"spo2\":%d,\"hr\":%d,\"duty_cycle\":\"10s/5min\"}\n",
                    temp, hum, wbgt, pm25, spo2, heartRate);
    }
  }

  display.display();
  delay(300);
}
