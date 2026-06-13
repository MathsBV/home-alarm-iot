/*
  Projeto: Sistema de Alarme - ESP32 + FPGA Basys 3 via UART + MQTT HiveMQ Cloud

  Arquitetura:
    Sensores -> ESP32 -> UART -> FPGA/Basys 3 -> Atuadores
    ESP32 <-> MQTT TLS 8883 <-> HiveMQ Cloud <-> Gateway Node.js <-> App Mobile

  UART:
    Baud rate: 115200 / 8N1
    GPIO17 TX2 -> FPGA RX / JB2
    GPIO16 RX2 <- FPGA TX / JB1

  Sensores:
    Zona 1: Reed switch 1               -> GPIO25
    Zona 2: Reed switch 2               -> GPIO33
    Zona 3: PIR + HC-SR04 nº1           -> PIR 13, TRIG 12, ECHO 14
    Zona 4: Sensor IR                   -> GPIO27
    Zona 5: HC-SR04 nº2                 -> TRIG 32, ECHO 35

  Pacotes UART:
    ESP32->FPGA zones:  0xA5 | 0x10 | ZONES        | FLAGS | CS
    ESP32->FPGA cmd:    0xA5 | 0x11 | CMD           | 0x00  | CS
    FPGA ->ESP32 status:0xA5 | 0x20 | STATUS        | ZONES_LATCHED | CS

  STATUS byte (FPGA->ESP32):
    bit0=armado  bit1=disparando  bit2=sirene  bit3=estrobo
    bit4=cerca   bit5=erro_com    bit6=em_atraso  bit7=reservado

  Bibliotecas (instalar via Library Manager):
    PubSubClient  by Nick O'Leary
    ArduinoJson   by Benoit Blanchon  v7+
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// =======================================================
// CREDENCIAIS — preencha antes de gravar
// =======================================================

const char* WIFI_SSID     = "SEU_WIFI_SSID";
const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";

// Crie usuário "esp32" / "Esp32123" no painel HiveMQ Cloud
const char* MQTT_HOST = "246dbd5916a940e0a718084dd7ae21f5.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT  = 8883;
const char* MQTT_USER     = "esp32";
const char* MQTT_PASS     = "Esp32123";

// Deve coincidir com DEVICE_ID no .env do gateway
const char* DEVICE_ID = "alarm-demo-001";

// =======================================================
// UART
// =======================================================

constexpr uint8_t  UART_RX_FPGA = 16;
constexpr uint8_t  UART_TX_FPGA = 17;
constexpr uint32_t UART_BAUD    = 115200;

// =======================================================
// Protocolo UART
// =======================================================

constexpr uint8_t UART_START            = 0xA5;
constexpr uint8_t TYPE_ZONES_FROM_ESP32 = 0x10;
constexpr uint8_t TYPE_CMD_TO_FPGA      = 0x11;
constexpr uint8_t TYPE_STATUS_FROM_FPGA = 0x20;

constexpr uint8_t CMD_FPGA_ARM    = 0x01;
constexpr uint8_t CMD_FPGA_DISARM = 0x02;
constexpr uint8_t CMD_FPGA_RESET  = 0x03;

// =======================================================
// Pinos
// =======================================================

constexpr uint8_t PIN_REED_Z1      = 25;
constexpr uint8_t PIN_REED_Z2      = 33;
constexpr uint8_t PIN_PIR_Z3       = 13;
constexpr uint8_t PIN_TRIG_Z3      = 12;
constexpr uint8_t PIN_ECHO_Z3      = 14;
constexpr uint8_t PIN_SENSOR_IR_Z4 = 27;
constexpr uint8_t PIN_TRIG_Z5      = 32;
constexpr uint8_t PIN_ECHO_Z5      = 35;
constexpr uint8_t LED_STATUS       = 2;

// =======================================================
// Habilitação das zonas
// =======================================================

constexpr bool HABILITAR_ZONA_1 = false;
constexpr bool HABILITAR_ZONA_2 = false;
constexpr bool HABILITAR_ZONA_3 = true;
constexpr bool HABILITAR_ZONA_4 = true;
constexpr bool HABILITAR_ZONA_5 = true;

// =======================================================
// Configurações
// =======================================================

constexpr unsigned long INTERVALO_SENSORES_MS   = 100;
constexpr unsigned long INTERVALO_ENVIO_UART_MS = 100;
constexpr unsigned long INTERVALO_DEBUG_MS      = 1000;
constexpr unsigned long INTERVALO_MQTT_STATE_MS = 500;
constexpr unsigned long INTERVALO_HEARTBEAT_MS  = 15000;
constexpr unsigned long INTERVALO_RECONEXAO_MS  = 5000;

constexpr unsigned long FILTRO_REED_MS          = 80;
constexpr unsigned long FILTRO_IR_Z4_MS         = 200;
constexpr unsigned long TIMEOUT_ULTRASSONICO_US = 12000;

constexpr float DISTANCIA_LIMITE_Z3_CM          = 8.0;
constexpr float DISTANCIA_LIMITE_Z5_CM          = 8.0;

constexpr bool REED_ATIVO_EM_HIGH               = true;
constexpr bool SENSOR_IR_ATIVO_EM_HIGH          = false;
constexpr bool ZONA3_EXIGE_PIR_E_ULTRASSONICO   = true;

// =======================================================
// Metadados das zonas (usados no payload MQTT)
// =======================================================

const char* ZONE_NAMES[5]        = {
  "Porta Principal", "Janela Sala", "Corredor", "Sala de Estar", "Garagem"
};
const char* ZONE_SENSOR_TYPES[5] = {
  "reed_switch", "reed_switch", "pir_ultrasonic", "ir", "ultrasonic"
};

// =======================================================
// Estruturas
// =======================================================

struct StatusFpga {
  bool armado               = false;
  bool disparando           = false;
  bool sireneLigada         = false;
  bool estroboLigado        = false;
  bool cercaHabilitada      = false;
  bool erroComunicacaoEsp32 = false;
  bool emAtraso             = false;
  bool zonasLatched[5]      = {false, false, false, false, false};
};

struct EstadoSensores {
  bool  zona1       = false;
  bool  zona2       = false;
  bool  zona3       = false;
  bool  zona4       = false;
  bool  zona5       = false;
  bool  pirZ3       = false;
  bool  irZ4Bruto   = false;
  float distanciaZ3 = 999.0;
  float distanciaZ5 = 999.0;
};

StatusFpga     statusFpga;
EstadoSensores sensores;

// =======================================================
// Estado global
// =======================================================

unsigned long ultimoCicloSensores  = 0;
unsigned long ultimoEnvioUart      = 0;
unsigned long ultimoDebug          = 0;
unsigned long ultimoPublishState   = 0;
unsigned long ultimoHeartbeat      = 0;
unsigned long ultimaTentativaMqtt  = 0;

uint8_t zonasAtuais = 0;
uint8_t flagsAtuais = 0;

bool heartbeat       = false;
bool alertaEnviadoOk = false;
bool wifiConectado   = false;

// =======================================================
// MQTT
// =======================================================

WiFiClientSecure wifiSecure;
PubSubClient     mqtt(wifiSecure);

char topicAvailability[80];
char topicState[80];
char topicEvents[80];
char topicCommands[80];
char topicCommandAcks[80];
char topicNotificationAcks[80];

uint32_t msgSequence  = 0;
uint32_t triggerCount = 0;
uint32_t eventCounter = 0;

bool prevArmado     = false;
bool prevDisparando = false;

char lwPayload[400]; // Last Will; reconstruído em conectarMqtt()

// =======================================================
// Parser UART
// =======================================================

enum RxState { RX_WAIT_START, RX_TYPE, RX_DATA0, RX_DATA1, RX_CHECKSUM };

RxState rxState = RX_WAIT_START;
uint8_t rxType  = 0;
uint8_t rxData0 = 0;
uint8_t rxData1 = 0;

// =======================================================
// Filtro digital
// =======================================================

struct FiltroDigital {
  bool          leituraAnterior  = false;
  bool          estadoFiltrado   = false;
  unsigned long instanteMudanca  = 0;
};

FiltroDigital filtroReedZ1, filtroReedZ2, filtroIrZ4;

bool atualizarFiltro(FiltroDigital& f, bool leitura, unsigned long ms) {
  unsigned long agora = millis();
  if (leitura != f.leituraAnterior) { f.leituraAnterior = leitura; f.instanteMudanca = agora; }
  if (agora - f.instanteMudanca >= ms) f.estadoFiltrado = leitura;
  return f.estadoFiltrado;
}

// =======================================================
// UART — envio e recepção
// =======================================================

uint8_t calcularChecksum(uint8_t s, uint8_t t, uint8_t d0, uint8_t d1) {
  return s ^ t ^ d0 ^ d1;
}

void enviarPacote(uint8_t type, uint8_t d0, uint8_t d1) {
  Serial2.write(UART_START);
  Serial2.write(type);
  Serial2.write(d0);
  Serial2.write(d1);
  Serial2.write(calcularChecksum(UART_START, type, d0, d1));
}

void enviarComandoFpga(uint8_t cmd) {
  enviarPacote(TYPE_CMD_TO_FPGA, cmd, 0x00);
}

void atualizarStatusFpga(uint8_t status, uint8_t zonasLatched) {
  statusFpga.armado               = (status & (1 << 0)) != 0;
  statusFpga.disparando           = (status & (1 << 1)) != 0;
  statusFpga.sireneLigada         = (status & (1 << 2)) != 0;
  statusFpga.estroboLigado        = (status & (1 << 3)) != 0;
  statusFpga.cercaHabilitada      = (status & (1 << 4)) != 0;
  statusFpga.erroComunicacaoEsp32 = (status & (1 << 5)) != 0;
  statusFpga.emAtraso             = (status & (1 << 6)) != 0;
  for (uint8_t i = 0; i < 5; i++)
    statusFpga.zonasLatched[i] = (zonasLatched & (1 << i)) != 0;
}

void processarByteRecebido(uint8_t b) {
  switch (rxState) {
    case RX_WAIT_START: if (b == UART_START) rxState = RX_TYPE; break;
    case RX_TYPE:  rxType  = b; rxState = RX_DATA0; break;
    case RX_DATA0: rxData0 = b; rxState = RX_DATA1; break;
    case RX_DATA1: rxData1 = b; rxState = RX_CHECKSUM; break;
    case RX_CHECKSUM: {
      if (b == calcularChecksum(UART_START, rxType, rxData0, rxData1)
          && rxType == TYPE_STATUS_FROM_FPGA)
        atualizarStatusFpga(rxData0, rxData1);
      rxState = RX_WAIT_START;
      break;
    }
  }
}

void lerPacotesDaFpga() {
  while (Serial2.available() > 0) {
    const int v = Serial2.read();
    if (v >= 0) processarByteRecebido(static_cast<uint8_t>(v));
  }
}

// =======================================================
// Sensores
// =======================================================

float medirDistanciaCm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW);  delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  const unsigned long dur = pulseIn(echo, HIGH, TIMEOUT_ULTRASSONICO_US);
  return (dur == 0) ? 999.0f : dur / 58.0f;
}

bool nivel(uint8_t pin, bool ativoEmHigh) {
  return ativoEmHigh ? digitalRead(pin) == HIGH : digitalRead(pin) == LOW;
}

bool lerZona1() {
  if (!HABILITAR_ZONA_1) return false;
  return atualizarFiltro(filtroReedZ1, nivel(PIN_REED_Z1, REED_ATIVO_EM_HIGH), FILTRO_REED_MS);
}

bool lerZona2() {
  if (!HABILITAR_ZONA_2) return false;
  return atualizarFiltro(filtroReedZ2, nivel(PIN_REED_Z2, REED_ATIVO_EM_HIGH), FILTRO_REED_MS);
}

bool lerZona3() {
  if (!HABILITAR_ZONA_3) { sensores.pirZ3 = false; sensores.distanciaZ3 = 999.0; return false; }
  sensores.pirZ3       = digitalRead(PIN_PIR_Z3) == HIGH;
  sensores.distanciaZ3 = medirDistanciaCm(PIN_TRIG_Z3, PIN_ECHO_Z3);
  const bool ult       = sensores.distanciaZ3 <= DISTANCIA_LIMITE_Z3_CM;
  return ZONA3_EXIGE_PIR_E_ULTRASSONICO ? (sensores.pirZ3 && ult) : (sensores.pirZ3 || ult);
}

bool lerZona4() {
  if (!HABILITAR_ZONA_4) { sensores.irZ4Bruto = false; return false; }
  sensores.irZ4Bruto = digitalRead(PIN_SENSOR_IR_Z4) == HIGH;
  return atualizarFiltro(filtroIrZ4,
    SENSOR_IR_ATIVO_EM_HIGH ? sensores.irZ4Bruto : !sensores.irZ4Bruto,
    FILTRO_IR_Z4_MS);
}

bool lerZona5() {
  if (!HABILITAR_ZONA_5) { sensores.distanciaZ5 = 999.0; return false; }
  sensores.distanciaZ5 = medirDistanciaCm(PIN_TRIG_Z5, PIN_ECHO_Z5);
  return sensores.distanciaZ5 <= DISTANCIA_LIMITE_Z5_CM;
}

void atualizarSensores() {
  sensores.zona1 = lerZona1();
  sensores.zona2 = lerZona2();
  sensores.zona3 = lerZona3();
  delay(5);
  sensores.zona4 = lerZona4();
  sensores.zona5 = lerZona5();

  zonasAtuais = 0;
  if (sensores.zona1) zonasAtuais |= (1 << 0);
  if (sensores.zona2) zonasAtuais |= (1 << 1);
  if (sensores.zona3) zonasAtuais |= (1 << 2);
  if (sensores.zona4) zonasAtuais |= (1 << 3);
  if (sensores.zona5) zonasAtuais |= (1 << 4);
}

// =======================================================
// Flags e envio UART
// =======================================================

uint8_t montarFlags() {
  uint8_t flags = 0;
  heartbeat = !heartbeat;
  if (heartbeat)       flags |= (1 << 0);
  if (alertaEnviadoOk) flags |= (1 << 1);
  if (wifiConectado)   flags |= (1 << 2);
  return flags;
}

void enviarZonasParaFpga() {
  flagsAtuais = montarFlags();
  enviarPacote(TYPE_ZONES_FROM_ESP32, zonasAtuais, flagsAtuais);
}

// =======================================================
// NTP e timestamp ISO 8601
// =======================================================

void sincronizarNtp() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.print("[NTP] Sincronizando");
  for (uint8_t i = 0; i < 20; i++) {
    struct tm t;
    if (getLocalTime(&t, 500)) {
      Serial.printf("\n[NTP] %04d-%02d-%02dT%02d:%02d:%02dZ\n",
        t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
        t.tm_hour, t.tm_min, t.tm_sec);
      return;
    }
    Serial.print(".");
  }
  Serial.println("\n[NTP] Falha — usando fallback");
}

void buildTimestamp(char* buf, size_t len) {
  struct tm t;
  if (getLocalTime(&t, 100)) {
    snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
      t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
      t.tm_hour, t.tm_min, t.tm_sec);
  } else {
    snprintf(buf, len, "1970-01-01T00:00:00.000Z");
  }
}

// =======================================================
// MQTT — utilitários
// =======================================================

const char* alarmMode() {
  if (statusFpga.disparando)                    return "triggered";
  if (statusFpga.armado && statusFpga.emAtraso) return "pending";
  if (statusFpga.armado)                        return "armed";
  return "disarmed";
}

void buildMessageId(char* buf, size_t len) {
  snprintf(buf, len, "esp32-%08lx-%05lu",
    (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFFUL),
    (unsigned long)msgSequence + 1);
}

void buildEventId(char* buf, size_t len) {
  snprintf(buf, len, "ev-%08lx-%05lu",
    (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFFUL),
    (unsigned long)(++eventCounter));
}

// =======================================================
// MQTT — publicações (payloads compatíveis com o schema)
// =======================================================

void publishAvailability(bool online, const char* reason) {
  char ts[32], msgId[64], payload[300];
  buildTimestamp(ts, sizeof(ts));
  buildMessageId(msgId, sizeof(msgId));

  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = msgId;
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = ts;
  doc["sequence"]      = ++msgSequence;
  doc["online"]        = online;
  doc["reason"]        = reason;

  serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(topicAvailability, payload, true);
}

void publishState() {
  char ts[32], msgId[64], payload[1024];
  buildTimestamp(ts, sizeof(ts));
  buildMessageId(msgId, sizeof(msgId));

  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = msgId;
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = ts;
  doc["sequence"]      = ++msgSequence;
  doc["mode"]          = alarmMode();
  doc["online"]        = true;
  doc["sirenActive"]   = statusFpga.sireneLigada;
  doc["delaySeconds"]  = 0;
  doc["triggerCount"]  = triggerCount;

  JsonArray zones = doc["zones"].to<JsonArray>();
  for (uint8_t i = 0; i < 5; i++) {
    JsonObject z  = zones.add<JsonObject>();
    z["id"]         = i + 1;
    z["name"]       = ZONE_NAMES[i];
    z["sensorType"] = ZONE_SENSOR_TYPES[i];
    z["violated"]   = statusFpga.zonasLatched[i];
  }

  JsonArray cm = doc["countermeasures"].to<JsonArray>();
  JsonObject siren  = cm.add<JsonObject>();
  siren["id"]    = "siren";
  siren["name"]  = "Sirene";
  siren["active"] = statusFpga.sireneLigada;
  JsonObject strobe = cm.add<JsonObject>();
  strobe["id"]    = "strobe";
  strobe["name"]  = "Estrobo";
  strobe["active"] = statusFpga.estroboLigado;

  serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(topicState, payload, true);
}

void publishEvent(
  const char* type,
  const char* title,
  const char* severity,
  int zoneId = -1
) {
  char ts[32], msgId[64], eventId[64], payload[600];
  buildTimestamp(ts, sizeof(ts));
  buildMessageId(msgId, sizeof(msgId));
  buildEventId(eventId, sizeof(eventId));

  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = msgId;
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = ts;
  doc["sequence"]      = ++msgSequence;
  doc["eventId"]       = eventId;
  doc["type"]          = type;
  doc["title"]         = title;
  doc["severity"]      = severity;
  if (zoneId > 0) doc["zoneId"] = zoneId;

  serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(topicEvents, payload);
}

void publishCommandAck(const char* requestId, bool accepted, const char* reason = nullptr) {
  char ts[32], msgId[64], payload[400];
  buildTimestamp(ts, sizeof(ts));
  buildMessageId(msgId, sizeof(msgId));

  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = msgId;
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = ts;
  doc["sequence"]      = ++msgSequence;
  doc["requestId"]     = requestId;
  doc["accepted"]      = accepted;
  if (!accepted && reason != nullptr) doc["reason"] = reason;

  serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(topicCommandAcks, payload);
}

// =======================================================
// MQTT — callback de comandos recebidos
// =======================================================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (length >= 1023) return;

  char buf[1024];
  memcpy(buf, payload, length);
  buf[length] = '\0';

  JsonDocument doc;
  if (deserializeJson(doc, buf) != DeserializationError::Ok) {
    Serial.println("[MQTT] JSON invalido");
    return;
  }

  const char* type      = doc["type"]      | "";
  const char* requestId = doc["messageId"] | "unknown";

  Serial.printf("[MQTT] Comando: %s\n", type);

  if (strcmp(type, "ARM") == 0) {
    if (!statusFpga.armado) {
      enviarComandoFpga(CMD_FPGA_ARM);
      publishCommandAck(requestId, true);
    } else {
      publishCommandAck(requestId, false, "already-armed");
    }

  } else if (strcmp(type, "DISARM") == 0) {
    enviarComandoFpga(CMD_FPGA_DISARM);
    alertaEnviadoOk = false;
    publishCommandAck(requestId, true);

  } else if (strcmp(type, "SILENCE") == 0) {
    enviarComandoFpga(CMD_FPGA_DISARM);
    alertaEnviadoOk = false;
    publishCommandAck(requestId, true);

  } else {
    publishCommandAck(requestId, false, "unsupported-command");
    return;
  }

  delay(50);
  publishState();
}

// =======================================================
// MQTT — conexão e manutenção
// =======================================================

bool conectarMqtt() {
  Serial.printf("[MQTT] Conectando a %s...", MQTT_HOST);

  // Reconstrói LWT com timestamp atual (pós-NTP)
  {
    char ts[32], msgId[64];
    buildTimestamp(ts, sizeof(ts));
    buildMessageId(msgId, sizeof(msgId));
    snprintf(lwPayload, sizeof(lwPayload),
      "{\"schemaVersion\":1,\"messageId\":\"%s\",\"deviceId\":\"%s\","
      "\"occurredAt\":\"%s\",\"sequence\":0,\"online\":false,\"reason\":\"last-will\"}",
      msgId, DEVICE_ID, ts);
  }

  const bool ok = mqtt.connect(
    DEVICE_ID, MQTT_USER, MQTT_PASS,
    topicAvailability, 1, true, lwPayload
  );

  if (ok) {
    Serial.println(" ok!");
    publishAvailability(true, "connected");
    mqtt.subscribe(topicCommands);
    mqtt.subscribe(topicNotificationAcks);
    publishState();
    return true;
  }

  Serial.printf(" falhou rc=%d\n", mqtt.state());
  return false;
}

void manterMqtt() {
  if (!wifiConectado) return;

  if (!mqtt.connected()) {
    const unsigned long agora = millis();
    if (agora - ultimaTentativaMqtt >= INTERVALO_RECONEXAO_MS) {
      ultimaTentativaMqtt = agora;
      conectarMqtt();
    }
    return;
  }

  mqtt.loop();
}

// =======================================================
// WiFi
// =======================================================

void configurarWifi() {
  Serial.printf("[WiFi] Conectando a %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  for (uint8_t i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    wifiConectado = false;
    Serial.println("\n[WiFi] Falha — operando sem nuvem");
  }
}

// =======================================================
// Detecção de eventos
// =======================================================

void detectarEventos() {
  if (!mqtt.connected()) {
    prevArmado = statusFpga.armado; prevDisparando = statusFpga.disparando; return;
  }

  if (statusFpga.disparando && !prevDisparando) {
    triggerCount++;
    int primeiraZona = -1;
    for (uint8_t i = 0; i < 5; i++) {
      if (statusFpga.zonasLatched[i]) { primeiraZona = i + 1; break; }
    }
    publishEvent("ALARM_TRIGGERED", "Alarme disparado", "critical", primeiraZona);
    publishState();
    alertaEnviadoOk = true;
  }

  if (statusFpga.armado && !prevArmado) {
    publishEvent("ALARM_ARMED", "Sistema armado", "info");
    publishState();
  }

  if (!statusFpga.armado && prevArmado) {
    alertaEnviadoOk = false;
    publishEvent("ALARM_DISARMED", "Sistema desarmado", "info");
    publishState();
  }

  prevArmado     = statusFpga.armado;
  prevDisparando = statusFpga.disparando;
}

// =======================================================
// Debug serial
// =======================================================

void imprimirByteBinario(uint8_t v) {
  for (int i = 7; i >= 0; i--) Serial.print((v >> i) & 1);
}

void imprimirDistancia(float d) {
  if (d >= 999.0) Serial.print("sem resposta");
  else { Serial.print(d, 1); Serial.print(" cm"); }
}

void imprimirStatusDebug() {
  Serial.println();
  Serial.println("======== DEBUG ESP32 ALARME ========");
  Serial.printf("WiFi: %s\n",
    wifiConectado ? WiFi.localIP().toString().c_str() : "desconectado");
  Serial.printf("MQTT: %s\n", mqtt.connected() ? "conectado" : "desconectado");
  Serial.printf("Modo: %s\n", alarmMode());
  Serial.print("ZONES: 0b"); imprimirByteBinario(zonasAtuais); Serial.println();
  Serial.print("FLAGS: 0b"); imprimirByteBinario(flagsAtuais); Serial.println();
  Serial.println("------------------------------------");
  Serial.printf("Z1 Reed:  %s\n", !HABILITAR_ZONA_1 ? "DESATIV" : (sensores.zona1 ? "VIOLADA" : "ok"));
  Serial.printf("Z2 Reed:  %s\n", !HABILITAR_ZONA_2 ? "DESATIV" : (sensores.zona2 ? "VIOLADA" : "ok"));
  Serial.printf("Z3 PIR:   %s  dist: ", sensores.pirZ3 ? "ATIVO" : "inativo");
  imprimirDistancia(sensores.distanciaZ3); Serial.printf("  -> %s\n", sensores.zona3 ? "VIOLADA" : "ok");
  Serial.printf("Z4 IR:    GPIO27=%s  -> %s\n",
    sensores.irZ4Bruto ? "HIGH" : "LOW", sensores.zona4 ? "VIOLADA" : "ok");
  Serial.print("Z5 dist:  "); imprimirDistancia(sensores.distanciaZ5);
  Serial.printf("  -> %s\n", sensores.zona5 ? "VIOLADA" : "ok");
  Serial.println("------------------------------------");
  Serial.printf("armado=%s  disparando=%s  em_atraso=%s\n",
    statusFpga.armado     ? "S" : "N",
    statusFpga.disparando ? "S" : "N",
    statusFpga.emAtraso   ? "S" : "N");
  Serial.printf("sirene=%s  estrobo=%s  cerca=%s  erroCom=%s\n",
    statusFpga.sireneLigada         ? "S" : "N",
    statusFpga.estroboLigado        ? "S" : "N",
    statusFpga.cercaHabilitada      ? "S" : "N",
    statusFpga.erroComunicacaoEsp32 ? "S" : "N");
  Serial.print("Zonas travadas: ");
  bool any = false;
  for (uint8_t i = 0; i < 5; i++)
    if (statusFpga.zonasLatched[i]) { Serial.printf("%d ", i + 1); any = true; }
  if (!any) Serial.print("nenhuma");
  Serial.println();
  Serial.println("====================================");
}

// =======================================================
// Setup
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial2.begin(UART_BAUD, SERIAL_8N1, UART_RX_FPGA, UART_TX_FPGA);

  pinMode(PIN_REED_Z1,      INPUT_PULLUP);
  pinMode(PIN_REED_Z2,      INPUT_PULLUP);
  pinMode(PIN_PIR_Z3,       INPUT);
  pinMode(PIN_TRIG_Z3,      OUTPUT);
  pinMode(PIN_ECHO_Z3,      INPUT);
  pinMode(PIN_SENSOR_IR_Z4, INPUT_PULLUP);
  pinMode(PIN_TRIG_Z5,      OUTPUT);
  pinMode(PIN_ECHO_Z5,      INPUT);
  pinMode(LED_STATUS,       OUTPUT);

  digitalWrite(PIN_TRIG_Z3, LOW);
  digitalWrite(PIN_TRIG_Z5, LOW);
  digitalWrite(LED_STATUS,  LOW);

  Serial.println("\nESP32 — Alarme UART + MQTT");
  Serial.printf("Device: %s\n", DEVICE_ID);

  snprintf(topicAvailability,     sizeof(topicAvailability),
    "home-alarm/v1/%s/availability",     DEVICE_ID);
  snprintf(topicState,            sizeof(topicState),
    "home-alarm/v1/%s/state",            DEVICE_ID);
  snprintf(topicEvents,           sizeof(topicEvents),
    "home-alarm/v1/%s/events",           DEVICE_ID);
  snprintf(topicCommands,         sizeof(topicCommands),
    "home-alarm/v1/%s/commands",         DEVICE_ID);
  snprintf(topicCommandAcks,      sizeof(topicCommandAcks),
    "home-alarm/v1/%s/command-acks",     DEVICE_ID);
  snprintf(topicNotificationAcks, sizeof(topicNotificationAcks),
    "home-alarm/v1/%s/notification-acks",DEVICE_ID);

  configurarWifi();

  if (wifiConectado) sincronizarNtp();

  // TLS sem verificação de certificado (adequado para demonstração)
  wifiSecure.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);
  mqtt.setCallback(mqttCallback);

  if (wifiConectado) conectarMqtt();
}

// =======================================================
// Loop
// =======================================================

void loop() {
  lerPacotesDaFpga();

  const unsigned long agora = millis();

  if (agora - ultimoCicloSensores >= INTERVALO_SENSORES_MS) {
    ultimoCicloSensores = agora;
    atualizarSensores();
  }

  if (agora - ultimoEnvioUart >= INTERVALO_ENVIO_UART_MS) {
    ultimoEnvioUart = agora;
    enviarZonasParaFpga();
    digitalWrite(LED_STATUS, !digitalRead(LED_STATUS));
  }

  const bool wifiAtual = (WiFi.status() == WL_CONNECTED);
  if (wifiAtual != wifiConectado) wifiConectado = wifiAtual;

  manterMqtt();
  detectarEventos();

  if (mqtt.connected() && agora - ultimoPublishState >= INTERVALO_MQTT_STATE_MS) {
    ultimoPublishState = agora;
    publishState();
  }

  if (mqtt.connected() && agora - ultimoHeartbeat >= INTERVALO_HEARTBEAT_MS) {
    ultimoHeartbeat = agora;
    publishAvailability(true, "heartbeat");
  }

  if (agora - ultimoDebug >= INTERVALO_DEBUG_MS) {
    ultimoDebug = agora;
    imprimirStatusDebug();
  }
}
