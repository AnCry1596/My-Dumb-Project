// SmartDoor ESP32 firmware — polls the Next.js dashboard for armed/disarmed state
// and posts every door event to it. No MQTT: all control now lives on the server
// (manual arm/disarm, one-off "disarm until", recurring weekly schedule).
//
// Libraries needed (Arduino IDE > Tools > Manage Libraries):
//   "WiFiManager" by tzapu
//   "ArduinoJson" by Benoit Blanchon
//   "LiquidCrystal" is bundled with Arduino IDE, no install needed
//
// Wiring:
//   LOCK_LED_PIN -> LED (+ resistor) : stands in for the real lock actuator
//   HALL_PIN     -> A3144 D0, VCC->3V3, GND->GND (uses internal pull-up, LOW = magnet near = door closed)
//   BUZZER_PIN   -> active buzzer I/O pin, VCC->3V3, GND->GND
//   LCD1602 (parallel, 4-bit) -> RS->13, RW->GND, E->12, D4->14, D5->27, D6->26, D7->25
//                                 VSS->GND, VDD->5V, V0->contrast pot wiper, A->5V, K->GND
//
// Set USE_LCD to 0 to test without the LCD wired up — status prints to Serial (115200 baud) instead.
//
// First-boot setup: device starts its own WiFi AP "SmartDoor-Setup" (no password).
// Connect to it, a captive portal page opens automatically. Enter your home WiFi
// and the 6-digit pairing code shown on the dashboard's "Add device" page — that's
// it, only two things to fill in. The dashboard URL always comes from
// DEFAULT_DASHBOARD_URL below (edit it and reflash if you ever need a different
// server; not exposed in the portal to keep setup simple and avoid typos).
// The device generates its own random auth token locally (no need to type one in)
// and registers it with the dashboard during the pairing claim. WiFiManager saves
// WiFi creds to flash; this sketch saves the rest to Preferences. To re-run setup
// later, hold BOOT (GPIO0) during power-on for 3s, or clear WiFi settings via
// WiFiManager's portal.
//
// Armed state comes from the dashboard, polled every STATE_POLL_MS. While disarmed
// (by manual toggle, one-off override, or recurring schedule), the door sensor still
// reports every open/close to the dashboard as usual — the server decides whether
// that's alarm-worthy based on its own schedule, and only the local buzzer/LED are
// silenced here. Nothing about logging changes based on armed state.

#define USE_LCD 0

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#if USE_LCD
#include <LiquidCrystal.h>
#endif
#include <string.h>

const int LOCK_LED_PIN = 2;   // ponytail: onboard LED stands in for real lock, swap to relay/servo pin when hardware arrives
const int HALL_PIN     = 4;   // A3144 OUT, open-collector, LOW = magnet present = door closed
const int BUZZER_PIN   = 15;  // active buzzer, HIGH = on
const int SETUP_BUTTON_PIN = 0; // BOOT button on most ESP32 dev boards
const unsigned long STATE_POLL_MS = 5000; // how often to ask the dashboard for armed/disarmed state

// ponytail: locked to the local dev server for testing — switch to your public https:// URL once hosted
// const char* DEFAULT_DASHBOARD_URL = "http://192.168.79.2:3000";
const char* DEFAULT_DASHBOARD_URL = "https://smartdoor.annnekkk.com";

Preferences prefs;
String deviceId;          // stable per-chip id, generated once
String dashboardUrl;      // e.g. https://your-dashboard.example.com  (no trailing slash)
String deviceToken;       // random secret this device generates itself, registered with the dashboard at claim time

String generateToken() {
  String t;
  for (int i = 0; i < 32; i++) t += "0123456789abcdef"[esp_random() % 16];
  return t;
}

WiFiClient plainClient;      // used when dashboardUrl is http:// (local testing)
WiFiClientSecure espClient;  // used when dashboardUrl is https:// (hosted)

// HTTPClient's begin() needs a client that matches the URL's scheme — a
// WiFiClientSecure can't speak plain http://. Picks the right one so dashboardUrl
// can be switched between local testing and a real hosted URL without code changes.
bool beginDashboardRequest(HTTPClient& http, const String& path) {
  String url = dashboardUrl + path;
  bool ok = url.startsWith("https://") ? http.begin(espClient, url) : http.begin(plainClient, url);
  http.setTimeout(3000); // ponytail: fail fast if the server is unreachable instead of blocking loop() for the platform default
  http.setConnectTimeout(3000);
  return ok;
}
#if USE_LCD
LiquidCrystal lcd(13, 12, 14, 27, 26, 25); // RS, E, D4, D5, D6, D7
#endif

bool armed = true;        // last known state from the dashboard
bool lastDoorOpen = false;
unsigned long lastStatePoll = 0;

String isoTimestamp() {
  time_t now = time(nullptr);
  struct tm t;
  gmtime_r(&now, &t);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

void showLine2(const char* text) {
  Serial.println(text);
#if USE_LCD
  lcd.setCursor(0, 1);
  lcd.print(text);
  for (int i = strlen(text); i < 16; i++) lcd.print(' '); // pad to clear leftovers
#endif
}

// Fire-and-forget: logs one event via the dashboard's API, does not block the door logic on failure.
// Always sends alarm:false — the server independently recomputes whether this is alarm-worthy
// from its own schedule/override state, which is the authority, not this device's local `armed` copy.
void logToMongo(const char* event) {
  if (WiFi.status() != WL_CONNECTED || dashboardUrl.isEmpty()) return;

  String body = String("{\"time\":\"") + isoTimestamp() +
    "\",\"event\":\"" + event +
    "\",\"deviceId\":\"" + deviceId + "\"}";

  HTTPClient http;
  beginDashboardRequest(http, "/api/log");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", deviceToken);
  int code = http.POST(body);
  Serial.println("Log [" + String(event) + "] -> HTTP " + String(code));
  http.end();
}

// Polls the dashboard for current armed/disarmed state. Called on a timer from loop()
// so schedule/override/manual-toggle changes made on the dashboard reach the device
// within STATE_POLL_MS, without needing MQTT or any inbound connection to the device.
void pollState() {
  if (WiFi.status() != WL_CONNECTED || dashboardUrl.isEmpty()) return;

  HTTPClient http;
  beginDashboardRequest(http, "/api/devices/state?deviceId=" + deviceId);
  http.addHeader("x-device-token", deviceToken);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
      armed = doc["armed"] | true;
      showLine2(armed ? "System: ARMED" : "System: disarmed");
    }
  } else {
    Serial.println("State poll -> HTTP " + String(code));
  }
  http.end();
}

void publishStatus(bool isOpen) {
  Serial.println(isOpen ? "Door: OPEN" : "Door: CLOSED");
#if USE_LCD
  lcd.setCursor(0, 0);
  lcd.print(isOpen ? "Door: OPEN    " : "Door: CLOSED  ");
#endif
  logToMongo(isOpen ? "DOOR_OPEN" : "DOOR_CLOSE");
}

// Sends this device's id + the pairing code entered during setup to the dashboard,
// linking it to whichever owner account generated that code. Runs once; the dashboard
// clears the pairing code after a successful claim, so retrying with a stale code
// will just fail harmlessly (the device stays "unclaimed" and logs won't show up
// under any owner, but WiFi/local sensing/buzzer keep working regardless).
void claimDeviceWithDashboard(const String& claimCode) {
  if (dashboardUrl.isEmpty() || claimCode.isEmpty()) return;

  HTTPClient http;
  beginDashboardRequest(http, "/api/devices/claim");
  http.addHeader("Content-Type", "application/json");
  String body = "{\"deviceId\":\"" + deviceId + "\",\"claimCode\":\"" + claimCode +
    "\",\"token\":\"" + deviceToken + "\"}";
  int code = http.POST(body);
  Serial.println("Claim -> HTTP " + String(code));
  http.end();
}

// Runs the WiFiManager captive portal: device becomes its own WiFi AP ("SmartDoor-Setup"),
// serves a config page with a pairing-code field alongside WiFiManager's own WiFi
// SSID/password fields. Blocks until the user submits the form and WiFi connects
// successfully (or times out and reboots to retry).
void runSetupPortal() {
  WiFiManager wm;

  wm.setTitle("SmartDoor Setup");
  wm.setCustomHeadElement(
    "<style>body{text-align:center}</style>"
    "<p>Connect this device to your home WiFi, then enter the 6-digit pairing "
    "code shown on the SmartDoor dashboard's \"Add device\" page.</p>"
  );

  WiFiManagerParameter p_claim("claim", "Pairing Code (from dashboard)", "", 8);
  wm.addParameter(&p_claim);

  wm.setConfigPortalTimeout(300); // 5 min, then reboot and retry rather than hang forever

  Serial.println("Starting setup portal: connect to WiFi \"SmartDoor-Setup\"");
#if USE_LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Setup mode:");
  lcd.setCursor(0, 1);
  lcd.print("WiFi SmartDoor-Setup");
#endif

  if (!wm.autoConnect("SmartDoor-Setup")) {
    Serial.println("Setup portal timed out, rebooting...");
    delay(1000);
    ESP.restart();
  }

  dashboardUrl = DEFAULT_DASHBOARD_URL;
  String claimCode = String(p_claim.getValue());

  prefs.putString("dashboardUrl", dashboardUrl);

  Serial.println("WiFi connected, IP=" + WiFi.localIP().toString());

  configTime(0, 0, "pool.ntp.org");
  Serial.print("Syncing time");
  while (time(nullptr) < 100000) { delay(500); Serial.print("."); }
  Serial.println(" done");

  if (!claimCode.isEmpty()) claimDeviceWithDashboard(claimCode);
}

// Holding BOOT (GPIO0) for 3s at power-on forces the setup portal even if WiFi
// creds are already saved — the normal way to re-pair or move to a new WiFi network.
bool setupButtonHeld() {
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  if (digitalRead(SETUP_BUTTON_PIN) != LOW) return false;
  unsigned long start = millis();
  while (digitalRead(SETUP_BUTTON_PIN) == LOW) {
    if (millis() - start > 3000) return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);

  pinMode(LOCK_LED_PIN, OUTPUT);
  pinMode(HALL_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

#if USE_LCD
  lcd.begin(16, 2);
  lcd.setCursor(0, 0);
  lcd.print("Connecting...");
#endif

  prefs.begin("smartdoor", false);
  deviceId = prefs.getString("deviceId", "");
  if (deviceId.isEmpty()) {
    deviceId = "esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    prefs.putString("deviceId", deviceId);
  }
  deviceToken = prefs.getString("deviceToken", "");
  if (deviceToken.isEmpty()) {
    deviceToken = generateToken();
    prefs.putString("deviceToken", deviceToken);
  }
  dashboardUrl = prefs.getString("dashboardUrl", DEFAULT_DASHBOARD_URL);

  espClient.setInsecure(); // ponytail: skips CA verification for the dashboard's HTTPS cert like most ESP32 demos; pin it if this goes past a hobby project

  bool forceSetup = setupButtonHeld();

  if (forceSetup || dashboardUrl.isEmpty()) {
    runSetupPortal();
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.begin(); // uses credentials WiFiManager already saved to flash
    Serial.print("Connecting to saved WiFi");
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
      if (millis() - start > 15000) { // saved WiFi unreachable -> fall back to setup portal
        Serial.println(" failed, falling back to setup portal");
        runSetupPortal();
        break;
      }
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println(" connected, IP=" + WiFi.localIP().toString());
      configTime(0, 0, "pool.ntp.org");
      Serial.print("Syncing time");
      while (time(nullptr) < 100000) { delay(500); Serial.print("."); }
      Serial.println(" done");
    }
  }

  pollState();
  showLine2("Ready");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  if (millis() - lastStatePoll > STATE_POLL_MS) {
    lastStatePoll = millis();
    pollState();
  }

  bool doorOpen = digitalRead(HALL_PIN) == HIGH; // no magnet nearby = door open

  // Drive the buzzer off the sensor immediately — before any network call — so it
  // reacts instantly even if the dashboard is unreachable. Buzzer only sounds while
  // armed; while disarmed (manual/schedule/override) the door is still logged below,
  // just silently.
  digitalWrite(BUZZER_PIN, (doorOpen && armed) ? HIGH : LOW);

  if (doorOpen != lastDoorOpen) {
    lastDoorOpen = doorOpen;
    publishStatus(doorOpen); // network call — buzzer state above is already set regardless of how long this takes
  }

  delay(200); // ponytail: simple debounce via poll interval, add proper debounce if the sensor chatters
}
