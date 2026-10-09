/*
  BLINDWAY — Smart Road Crossing

  RED = pedestrians may cross if road is clear
  YELLOW = WAIT
  GREEN = vehicles go; pedestrians WAIT

  Red LED: D8
  Yellow LED: D9
  Green LED: D10
  Buzzer: D11
  Ultrasonic TRIG: D13
  Ultrasonic ECHO: A0

  Serial baud rate: 9600
*/

const int RED_PIN = 8;
const int YELLOW_PIN = 9;
const int GREEN_PIN = 10;
const int BUZZER_PIN = 11;
const int TRIG_PIN = 13;
const int ECHO_PIN = A0;

const int DANGER_CM = 10;

const unsigned long BEEP_MS = 1000;
const unsigned long SENSOR_MS = 100;
const unsigned long REPORT_MS = 500;

enum Phase { P_RED, P_YELLOW, P_GREEN };
enum Safe { S_SAFE, S_DANGER, S_UNKNOWN };

const char* PHASE_NAME[] = {"RED", "YELLOW", "GREEN"};
const char* SAFE_NAME[] = {"SAFE", "DANGER", "UNKNOWN"};

// RED, YELLOW, GREEN durations
unsigned long durationMs[3] = {
  5000UL, 3000UL, 10000UL
};

Phase phase = P_GREEN;
Safe safety = S_UNKNOWN;

unsigned long phaseStart = 0;
unsigned long phaseLength = 0;
unsigned long lastSensor = 0;
unsigned long lastReport = 0;
unsigned long beepStart = 0;
unsigned long lastToggle = 0;

long distanceCm = -1;

bool crossingNotified = false;
bool crossingBeepActive = false;
bool dangerToneActive = false;

String inBuf;

long readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);

  if (us == 0) return -1;

  long cm = us / 58;

  if (cm < 2 || cm > 400) return -1;

  return cm;
}

void stopBuzzer() {
  crossingBeepActive = false;
  dangerToneActive = false;
  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
}

void setLeds() {
  digitalWrite(RED_PIN, phase == P_RED);
  digitalWrite(YELLOW_PIN, phase == P_YELLOW);
  digitalWrite(GREEN_PIN, phase == P_GREEN);
}

void report() {
  Serial.print("LIGHT:");
  Serial.println(PHASE_NAME[phase]);

  if (distanceCm < 0) {
    Serial.println("DISTANCE:INVALID");
  } else {
    Serial.print("DISTANCE:");
    Serial.println(distanceCm);
  }

  Serial.print("STATUS:");
  Serial.println(SAFE_NAME[safety]);
}

void enterPhase(Phase p) {
  stopBuzzer();

  phase = p;
  phaseStart = millis();
  phaseLength = durationMs[phase];

  crossingNotified = false;

  setLeds();

  Serial.print("LIGHT:");
  Serial.println(PHASE_NAME[phase]);

  // Only announce a crossing when RED begins and
  // the sensor has already confirmed the road is clear.
  if (phase == P_RED &&
      safety == S_SAFE &&
      !crossingNotified) {

    crossingNotified = true;
    crossingBeepActive = true;
    beepStart = millis();

    tone(BUZZER_PIN, 2000);
    Serial.println("EVENT:RED_SAFE");
  }

  report();
}

void handleCommand(String c) {
  c.trim();
  c.toUpperCase();

  if (!c.startsWith("SET_TIMING,")) return;

  int a = c.indexOf(',');
  int b = c.indexOf(',', a + 1);

  if (b < 0) {
    Serial.println("TIMING_ERROR:FORMAT");
    return;
  }

  String ph = c.substring(a + 1, b);
  String v = c.substring(b + 1);

  int idx = ph == "RED" ? 0 :
            ph == "YELLOW" ? 1 :
            ph == "GREEN" ? 2 : -1;

  if (idx < 0 || v.length() == 0 || v.length() > 2) {
    Serial.println("TIMING_ERROR:VALUE");
    return;
  }

  for (unsigned int i = 0; i < v.length(); i++) {
    if (!isDigit(v[i])) {
      Serial.println("TIMING_ERROR:VALUE");
      return;
    }
  }

  int seconds = v.toInt();

  if (seconds < 1 || seconds > 60) {
    Serial.println("TIMING_ERROR:RANGE");
    return;
  }

  durationMs[idx] = (unsigned long)seconds * 1000UL;

  Serial.print("TIMING_SET:");
  Serial.print(ph);
  Serial.print(",");
  Serial.println(seconds);
}

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();

    if (ch == '\n') {
      handleCommand(inBuf);
      inBuf = "";
    } else if (ch != '\r' && inBuf.length() < 40) {
      inBuf += ch;
    }
  }
}

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  digitalWrite(BUZZER_PIN, LOW);

  Serial.begin(9600);
  inBuf.reserve(40);

  enterPhase(P_GREEN);
}

void loop() {
  unsigned long now = millis();

  readSerial();

  // Read ultrasonic sensor
  if (now - lastSensor >= SENSOR_MS) {
    lastSensor = now;

    distanceCm = readDistance();

    Safe nextSafety =
      distanceCm < 0 ? S_UNKNOWN :
      distanceCm < DANGER_CM ? S_DANGER :
      S_SAFE;

    if (nextSafety != safety) {
      safety = nextSafety;

      Serial.print("STATUS:");
      Serial.println(SAFE_NAME[safety]);

      if (safety == S_DANGER) {
        Serial.println("EVENT:VEHICLE_DETECTED");

        // Cancel the normal crossing beep immediately.
        stopBuzzer();
        crossingNotified = false;
      }

      if (safety == S_UNKNOWN) {
        stopBuzzer();
      }
    }
  }

  // Change traffic-light phase
  if (now - phaseStart >= phaseLength) {
    Phase nextPhase =
      phase == P_GREEN ? P_YELLOW :
      phase == P_YELLOW ? P_RED :
      P_GREEN;

    enterPhase(nextPhase);
  }

  // NORMAL CROSSING BEEP:
  // RED + SAFE only. Never beep normally on GREEN or YELLOW.
  if (phase == P_RED &&
      safety == S_SAFE &&
      !crossingNotified) {

    crossingNotified = true;
    crossingBeepActive = true;
    beepStart = millis();

    tone(BUZZER_PIN, 2000);
    Serial.println("EVENT:RED_SAFE");
  }

  // Stop the normal beep after one second.
  if (crossingBeepActive) {
    if (phase != P_RED || safety != S_SAFE) {
      stopBuzzer();
    } else if (millis() - beepStart >= BEEP_MS) {
      stopBuzzer();
    }
  }

  // DANGER warning: fast pulses only during RED.
  if (phase == P_RED && safety == S_DANGER) {
    if (millis() - lastToggle >= 150) {
      lastToggle = millis();
      dangerToneActive = !dangerToneActive;

      if (dangerToneActive) {
        tone(BUZZER_PIN, 3000);
      } else {
        noTone(BUZZER_PIN);
      }
    }
  } else if (dangerToneActive) {
    stopBuzzer();
  }

  // Force buzzer OFF during GREEN and YELLOW
  if (phase != P_RED) {
    stopBuzzer();
  }

  // Report current state to the website
  if (millis() - lastReport >= REPORT_MS) {
    lastReport = millis();
    report();
  }
}
