/*
  BLINDWAY - Smart Road Crossing

  CORRECT SIGNAL SEQUENCE:
  RED -> YELLOW -> GREEN -> RED

  RED    = Vehicles stop; buzzer follows sensor logic
  YELLOW = Wait; buzzer OFF
  GREEN  = Vehicles go; buzzer OFF

  Red LED:          D8
  Yellow LED:       D9
  Green LED:        D10
  Buzzer:           D11
  Ultrasonic TRIG:  D13
  Ultrasonic ECHO:  A0

  Serial Monitor: 9600 baud
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
const unsigned long DANGER_TOGGLE_MS = 150;

// Indexes: RED = 0, YELLOW = 1, GREEN = 2
enum Phase { P_RED, P_YELLOW, P_GREEN };
enum Safe { S_SAFE, S_DANGER, S_UNKNOWN };

const char* PHASE_NAME[] = {"RED", "YELLOW", "GREEN"};
const char* SAFE_NAME[] = {"SAFE", "DANGER", "UNKNOWN"};

// Durations in milliseconds: RED, YELLOW, GREEN
unsigned long durationMs[3] = {
  5000UL, 3000UL, 10000UL
};

Phase phase = P_RED;
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
bool dangerToneOn = false;

String inBuf;

// ---------------- ULTRASONIC SENSOR ----------------

long readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);

  if (us == 0) {
    return -1;
  }

  long cm = us / 58;

  if (cm < 2 || cm > 400) {
    return -1;
  }

  return cm;
}

// ---------------- BUZZER ----------------

void stopBuzzer() {
  crossingBeepActive = false;
  dangerToneOn = false;

  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
}

void updateBuzzer(unsigned long now) {

  // Buzzer must remain OFF during YELLOW and GREEN.
  if (phase != P_RED) {
    stopBuzzer();
    return;
  }

  // Unknown sensor reading: buzzer OFF.
  if (safety == S_UNKNOWN) {
    stopBuzzer();
    return;
  }

  // Danger detected within 10 cm: pulsing warning.
  if (safety == S_DANGER) {
    crossingBeepActive = false;

    if (now - lastToggle >= DANGER_TOGGLE_MS) {
      lastToggle = now;
      dangerToneOn = !dangerToneOn;

      if (dangerToneOn) {
        tone(BUZZER_PIN, 3000);
        Serial.println("BUZZER:DANGER_ON");
      } else {
        noTone(BUZZER_PIN);
        digitalWrite(BUZZER_PIN, LOW);
        Serial.println("BUZZER:DANGER_OFF");
      }
    }

    return;
  }

  // Safe reading: stop any previous danger tone.
  if (dangerToneOn) {
    dangerToneOn = false;
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  }

  // One normal crossing beep per RED phase.
  if (!crossingNotified) {
    crossingNotified = true;
    crossingBeepActive = true;
    beepStart = now;

    tone(BUZZER_PIN, 2000);

    Serial.println("EVENT:RED_SAFE");
    Serial.println("BUZZER:CROSSING_ON");
  }

  // Stop the normal beep after one second.
  if (crossingBeepActive &&
      now - beepStart >= BEEP_MS) {

    crossingBeepActive = false;

    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);

    Serial.println("BUZZER:CROSSING_OFF");
  }
}

// ---------------- TRAFFIC LIGHTS ----------------

void setLeds() {
  // Turn all lights OFF first.
  digitalWrite(RED_PIN, LOW);
  digitalWrite(YELLOW_PIN, LOW);
  digitalWrite(GREEN_PIN, LOW);

  // Turn ON only the selected light.
  if (phase == P_RED) {
    digitalWrite(RED_PIN, HIGH);
  }
  else if (phase == P_YELLOW) {
    digitalWrite(YELLOW_PIN, HIGH);
  }
  else if (phase == P_GREEN) {
    digitalWrite(GREEN_PIN, HIGH);
  }
}

void report() {
  Serial.print("LIGHT:");
  Serial.println(PHASE_NAME[(int)phase]);

  if (distanceCm < 0) {
    Serial.println("DISTANCE:INVALID");
  } else {
    Serial.print("DISTANCE:");
    Serial.println(distanceCm);
  }

  Serial.print("STATUS:");
  Serial.println(SAFE_NAME[(int)safety]);
}

void enterPhase(Phase p) {
  // Stop buzzer before changing the signal.
  stopBuzzer();

  phase = p;
  phaseStart = millis();
  phaseLength = durationMs[(int)phase];

  crossingNotified = false;

  setLeds();

  Serial.print("LIGHT:");
  Serial.println(PHASE_NAME[(int)phase]);

  Serial.print("DURATION_MS:");
  Serial.println(phaseLength);

  if (phase != P_RED) {
    Serial.println("BUZZER:FORCED_OFF");
  }

  report();
}

// ---------------- WEBSITE TIMING COMMANDS ----------------

// Commands:
// SET_TIMING,RED,5
// SET_TIMING,YELLOW,3
// SET_TIMING,GREEN,10
//
// Duration range: 1 to 60 seconds.

void handleCommand(String c) {
  c.trim();
  c.toUpperCase();

  if (!c.startsWith("SET_TIMING,")) {
    return;
  }

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

  // Apply the new duration immediately if active.
  if ((int)phase == idx) {
    phaseLength = durationMs[idx];
    phaseStart = millis();

    Serial.println("ACTIVE_PHASE_TIMER_RESET");
  }
}

void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();

    if (ch == '\n') {
      handleCommand(inBuf);
      inBuf = "";
    }
    else if (ch != '\r' && inBuf.length() < 40) {
      inBuf += ch;
    }
  }
}

// ---------------- SETUP ----------------

void setup() {
  pinMode(RED_PIN, OUTPUT);
  pinMode(YELLOW_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  digitalWrite(RED_PIN, LOW);
  digitalWrite(YELLOW_PIN, LOW);
  digitalWrite(GREEN_PIN, LOW);

  stopBuzzer();

  Serial.begin(9600);
  inBuf.reserve(40);

  Serial.println("BLINDWAY STARTING");
  Serial.println("SEQUENCE:RED->YELLOW->GREEN->RED");

  // Begin with RED.
  enterPhase(P_RED);
}

// ---------------- MAIN LOOP ----------------

void loop() {
  unsigned long now = millis();

  readSerial();

  // Read ultrasonic sensor every 100 ms.
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
      Serial.println(SAFE_NAME[(int)safety]);

      if (safety == S_DANGER) {
        Serial.println("EVENT:VEHICLE_DETECTED");
        crossingNotified = false;
        stopBuzzer();
      }

      if (safety == S_UNKNOWN) {
        Serial.println("SENSOR:INVALID_READING");
        stopBuzzer();
      }

      if (safety == S_SAFE) {
        Serial.println("SENSOR:SAFE_DISTANCE");
      }
    }
  }

  // CORRECT SEQUENCE:
  // RED -> YELLOW -> GREEN -> RED

  now = millis();

  if (now - phaseStart >= phaseLength) {
    Phase nextPhase;

    if (phase == P_RED) {
      nextPhase = P_YELLOW;
    }
    else if (phase == P_YELLOW) {
      nextPhase = P_GREEN;
    }
    else {
      nextPhase = P_RED;
    }

    enterPhase(nextPhase);
    now = millis();
  }

  // Update buzzer behavior.
  updateBuzzer(now);

  // Report status every 500 ms.
  if (millis() - lastReport >= REPORT_MS) {
    lastReport = millis();
    report();
  }
}
