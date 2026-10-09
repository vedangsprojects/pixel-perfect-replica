/*
  BLINDWAY — Smart Road Crossing (school prototype, NOT a certified safety system)

  Pins: Red D8, Yellow D9, Green D10, Buzzer D11, HC-SR04 TRIG D13, ECHO A0. Serial 9600.

  Cycle: GREEN (vehicles go) -> YELLOW -> RED (vehicles stop, pedestrians may cross).
  The 1-second crossing beep plays ONLY on RED when the sensor confirms the road is clear.
  Invalid sensor readings are never treated as safe.

  Serial OUT (newline terminated):
    LIGHT:RED | LIGHT:YELLOW | LIGHT:GREEN
    DISTANCE:18 | DISTANCE:INVALID
    STATUS:SAFE | STATUS:DANGER | STATUS:UNKNOWN
    EVENT:RED_SAFE | EVENT:VEHICLE_DETECTED
    TIMING_SET:RED,5   (acknowledgement)
    TIMING_ERROR:<reason>
  Serial IN:
    SET_TIMING,RED,5   (phase RED/YELLOW/GREEN, whole seconds 1-60)
*/

const int RED_PIN = 8;
const int YELLOW_PIN = 9;
const int GREEN_PIN = 10;
const int BUZZER_PIN = 11;
const int TRIG_PIN = 13;
const int ECHO_PIN = A0;

const int DANGER_CM = 10;               // object closer than this = vehicle in crossing
const unsigned long SENSOR_MS = 100;    // sensor read interval
const unsigned long REPORT_MS = 500;    // heartbeat report interval
const unsigned long BEEP_MS = 1000;     // crossing notification length

enum Phase { P_RED = 0, P_YELLOW = 1, P_GREEN = 2 };
enum Safe { S_SAFE = 0, S_DANGER = 1, S_UNKNOWN = 2 };
const char* PHASE_NAME[] = { "RED", "YELLOW", "GREEN" };
const char* SAFE_NAME[] = { "SAFE", "DANGER", "UNKNOWN" };

unsigned long durationMs[3] = { 5000UL, 3000UL, 10000UL };  // RED, YELLOW, GREEN

Phase phase = P_GREEN;
unsigned long phaseStart = 0;
unsigned long phaseLength = 0;   // captured at phase start -> new timings apply next cycle
Safe safety = S_UNKNOWN;
long distanceCm = -1;
unsigned long lastSensor = 0, lastReport = 0;

bool crossingNotified = false;   // one crossing beep per RED+SAFE event
bool beeping = false;
unsigned long beepStart = 0;
bool dangerTone = false;
unsigned long lastToggle = 0;

String inBuf;

long readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);  // ~4 m max, short timeout
  if (us == 0) return -1;                               // timeout -> invalid
  long cm = us / 58;
  if (cm < 2 || cm > 400) return -1;
  return cm;
}

void setLeds() {
  digitalWrite(RED_PIN, phase == P_RED);
  digitalWrite(YELLOW_PIN, phase == P_YELLOW);
  digitalWrite(GREEN_PIN, phase == P_GREEN);
}

void report() {
  Serial.print("LIGHT:"); Serial.println(PHASE_NAME[phase]);
  if (distanceCm < 0) Serial.println("DISTANCE:INVALID");
  else { Serial.print("DISTANCE:"); Serial.println(distanceCm); }
  Serial.print("STATUS:"); Serial.println(SAFE_NAME[safety]);
}

void stopBuzzer() {
  beeping = false;
  dangerTone = false;
  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
}

void enterPhase(Phase p) {
  phase = p;
  phaseStart = millis();
  phaseLength = durationMs[p];
  crossingNotified = false;
  stopBuzzer();
  setLeds();
  report();
}

void handleCommand(String c) {
  c.trim();
  c.toUpperCase();
  if (!c.startsWith("SET_TIMING,")) return;
  int a = c.indexOf(',');
  int b = c.indexOf(',', a + 1);
  if (b < 0) { Serial.println("TIMING_ERROR:FORMAT"); return; }
  String ph = c.substring(a + 1, b);
  String v = c.substring(b + 1);
  int idx = ph == "RED" ? 0 : ph == "YELLOW" ? 1 : ph == "GREEN" ? 2 : -1;
  if (idx < 0) { Serial.println("TIMING_ERROR:PHASE"); return; }
  if (v.length() < 1 || v.length() > 2) { Serial.println("TIMING_ERROR:VALUE"); return; }
  for (unsigned int i = 0; i < v.length(); i++)
    if (!isDigit(v[i])) { Serial.println("TIMING_ERROR:VALUE"); return; }
  int s = v.toInt();
  if (s < 1 || s > 60) { Serial.println("TIMING_ERROR:RANGE"); return; }
  durationMs[idx] = (unsigned long)s * 1000UL;
  Serial.print("TIMING_SET:"); Serial.print(ph); Serial.print(","); Serial.println(s);
}

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { handleCommand(inBuf); inBuf = ""; }
    else if (ch != '\r' && inBuf.length() < 40) inBuf += ch;
  }
}

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.begin(9600);
  inBuf.reserve(40);
  enterPhase(P_GREEN);
}

void loop() {
  unsigned long now = millis();
  readSerial();

  // Traffic-light cycle (non-blocking)
  if (now - phaseStart >= phaseLength) {
    enterPhase(phase == P_GREEN ? P_YELLOW : phase == P_YELLOW ? P_RED : P_GREEN);
  }

  // Sensor
  if (now - lastSensor >= SENSOR_MS) {
    lastSensor = now;
    distanceCm = readDistance();
    Safe next = distanceCm < 0 ? S_UNKNOWN : (distanceCm < DANGER_CM ? S_DANGER : S_SAFE);
    if (next != safety) {
      safety = next;
      Serial.print("STATUS:"); Serial.println(SAFE_NAME[safety]);
      if (phase == P_RED && safety == S_DANGER) {
        Serial.println("EVENT:VEHICLE_DETECTED");
        crossingNotified = false;  // a new clear reading afterwards is a new crossing event
      }
      if (safety != S_SAFE && beeping) stopBuzzer();  // cancel crossing beep
    }
  }

  // Normal crossing notification: RED + verified SAFE, once per event
  if (phase == P_RED && safety == S_SAFE && !crossingNotified) {
    crossingNotified = true;
    beeping = true;
    beepStart = now;
    tone(BUZZER_PIN, 2000);
    Serial.println("EVENT:RED_SAFE");
  }
  if (beeping && now - beepStart >= BEEP_MS) stopBuzzer();

  // Danger warning: fast pulses while a vehicle is in the crossing during RED
  if (phase == P_RED && safety == S_DANGER) {
    if (now - lastToggle >= 150) {
      lastToggle = now;
      dangerTone = !dangerTone;
      if (dangerTone) tone(BUZZER_PIN, 3000); else noTone(BUZZER_PIN);
    }
  } else if (dangerTone) {
    stopBuzzer();
  }

  // Heartbeat so the website never shows stale data
  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    report();
  }
}
