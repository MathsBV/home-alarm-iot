/*
  Projeto: Sistema de Alarme - ESP32 + FPGA Basys 3 via UART + MQTT (HiveMQ Cloud)

  Arquitetura:
    Sensores -> ESP32 -> UART -> FPGA/Basys 3 -> Atuadores
    ESP32 <-> MQTT (HiveMQ) <-> Gateway (Render) <-> App Mobile

  UART:
    Baud rate: 115200
    Formato: 8N1

  Ligações UART:
    ESP32 GPIO17 TX2 -> FPGA UART_RX / Basys 3 JB2
    ESP32 GPIO16 RX2 <- FPGA UART_TX / Basys 3 JB1
    ESP32 GND        <-> GND Basys 3

  Sensores:
    Zona 1: Reed switch 1               -> GPIO33
    Zona 2: Reed switch 2               -> GPIO25
    Zona 3: PIR + HC-SR04 número 1      -> PIR 13, TRIG 12, ECHO 14
    Zona 4: Sensor IR                   -> GPIO27
    Zona 5: HC-SR04 número 2            -> TRIG 32, ECHO 35

  Pacote ESP32 -> FPGA (zonas):
    0xA5 | 0x10 | ZONES | FLAGS | CHECKSUM
    FLAGS: bit0=heartbeat, bit1=alertaEnviadoOk, bit2=wifiConectado

  Pacote ESP32 -> FPGA (comando remoto):
    0xA5 | 0x11 | CMD | 0x00 | CHECKSUM
    CMD: 0x01=armar, 0x02=desarmar, 0x03=reset

  Pacote FPGA -> ESP32:
    0xA5 | 0x20 | STATUS | ZONES_LATCHED | CHECKSUM
    STATUS: bit0=armado, bit1=disparando, bit2=sirene, bit3=estrobo,
            bit4=cerca, bit5=erro_com, bit6=em_atraso, bit7=reservado

  Bibliotecas necessárias (instalar via Arduino Library Manager):
    - PubSubClient (Nick O'Leary)
    - ArduinoJson v7+ (Benoit Blanchon)
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "time.h"

// =======================================================
// WiFi — preencher antes de gravar
// =======================================================

#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// =======================================================
// MQTT (HiveMQ Cloud)
// =======================================================

#define MQTT_BROKER      "246dbd5916a940e0a718084dd7ae21f5.s1.eu.hivemq.cloud"
#define MQTT_PORT        8883
#define MQTT_USER        "esp32"
#define MQTT_PASS        "Esp32123"
#define DEVICE_ID        "alarm-demo-001"
#define MQTT_BUFFER_SIZE 1280

// =======================================================
// Tópicos MQTT
// =======================================================

#define TOPIC_ROOT         "home-alarm/v1/" DEVICE_ID
#define TOPIC_AVAILABILITY TOPIC_ROOT "/availability"
#define TOPIC_STATE        TOPIC_ROOT "/state"
#define TOPIC_EVENTS       TOPIC_ROOT "/events"
#define TOPIC_COMMANDS     TOPIC_ROOT "/commands"
#define TOPIC_CMD_ACKS     TOPIC_ROOT "/command-acks"
#define TOPIC_NOTIFY_ACKS  TOPIC_ROOT "/notification-acks"

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
constexpr uint8_t TYPE_CMD_TO_FPGA       = 0x11;
constexpr uint8_t TYPE_SET_DELAY_TO_FPGA = 0x12;
constexpr uint8_t TYPE_CM_TO_FPGA        = 0x13;
constexpr uint8_t TYPE_STATUS_FROM_FPGA  = 0x20;
constexpr uint8_t TYPE_DELAY_FROM_FPGA   = 0x21;

constexpr uint8_t CMD_ARMAR    = 0x01;
constexpr uint8_t CMD_DESARMAR = 0x02;
constexpr uint8_t CMD_RESET    = 0x03;

// =======================================================
// Pinos
// =======================================================

constexpr uint8_t PIN_REED_Z1     = 33;
constexpr uint8_t PIN_REED_Z2     = 25;

constexpr uint8_t PIN_PIR_Z3      = 13;
constexpr uint8_t PIN_TRIG_Z3     = 12;
constexpr uint8_t PIN_ECHO_Z3     = 14;

constexpr uint8_t PIN_SENSOR_IR_Z4 = 27;

constexpr uint8_t PIN_TRIG_Z5     = 32;
constexpr uint8_t PIN_ECHO_Z5     = 35;

constexpr uint8_t LED_STATUS      = 2;

// =======================================================
// Habilitação das zonas
// =======================================================

constexpr bool HABILITAR_ZONA_1 = true;
constexpr bool HABILITAR_ZONA_2 = true;
constexpr bool HABILITAR_ZONA_3 = true;
constexpr bool HABILITAR_ZONA_4 = true;
constexpr bool HABILITAR_ZONA_5 = true;

// =======================================================
// Configurações
// =======================================================

constexpr unsigned long INTERVALO_SENSORES_MS   = 100;
constexpr unsigned long INTERVALO_ENVIO_UART_MS = 100;
constexpr unsigned long INTERVALO_DEBUG_MS      = 5000;
constexpr unsigned long INTERVALO_ESTADO_MQTT_MS = 2000;

constexpr unsigned long FILTRO_REED_MS  = 80;
constexpr unsigned long FILTRO_IR_Z4_MS = 200;

constexpr unsigned long TIMEOUT_ULTRASSONICO_US = 12000;

constexpr float DISTANCIA_LIMITE_Z3_CM = 8.0;
constexpr float DISTANCIA_LIMITE_Z5_CM = 8.0;

// Reed ligado entre GPIO e GND com INPUT_PULLUP: fechado=LOW, aberto=HIGH.
constexpr bool REED_ATIVO_EM_HIGH = true;

// IR sem objeto=HIGH, com objeto=LOW.
constexpr bool SENSOR_IR_ATIVO_EM_HIGH = false;

// true: Zona 3 exige PIR E ultrassônico.
constexpr bool ZONA3_EXIGE_PIR_E_ULTRASSONICO = true;

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
  bool zona1 = false;
  bool zona2 = false;
  bool zona3 = false;
  bool zona4 = false;
  bool zona5 = false;

  bool  pirZ3      = false;
  bool  irZ4Bruto  = false;
  float distanciaZ3 = 999.0;
  float distanciaZ5 = 999.0;
};

// =======================================================
// Objetos WiFi / MQTT
// =======================================================

WiFiClientSecure wifiSecure;
PubSubClient     mqttClient(wifiSecure);

// =======================================================
// Estado global
// =======================================================

StatusFpga     statusFpga;
EstadoSensores sensores;

unsigned long ultimoCicloSensores = 0;
unsigned long ultimoEnvioUart     = 0;
unsigned long ultimoDebug         = 0;
unsigned long ultimoEstadoMqtt    = 0;
unsigned long ultimoReconectMqtt  = 0;

uint8_t zonasAtuais = 0;
uint8_t flagsAtuais = 0;

bool heartbeat       = false;
bool alertaEnviadoOk = false;
bool wifiConectado   = false;

uint32_t msgSequence      = 0;
uint32_t triggerCount     = 0;
uint8_t  delaySecondsConfig = 0;

// Atraso definido pelo app, enviado à FPGA via pacote 0x12.
uint8_t       delaySetpoint         = 0;
bool          delaySetpointDefinido = false;
unsigned long ultimoEnvioDelay      = 0;

bool prevArmado     = false;
bool prevDisparando = false;
bool prevEmAtraso   = false;

// Segundos restantes da temporização, reportados pela FPGA (pacote 0x21).
uint8_t delayRemainingFpga = 0;

// Setpoint manual das contramedidas, definido pelo app e enviado à FPGA (0x13).
// O acionamento automático no disparo é somado a isto dentro da própria FPGA.
bool          manualCm[3]   = {false, false, false};  // 0=sirene 1=estrobo 2=cerca
unsigned long ultimoEnvioCm = 0;

// Comando remoto em confirmação (closed-loop: reenvia até a FPGA confirmar).
struct CmdRemoto {
  bool          pendente      = false;
  uint8_t       cmd           = 0;   // CMD_ARMAR / CMD_DESARMAR / CMD_RESET
  char          requestId[48] = {};
  unsigned long inicio        = 0;   // instante do pedido (para timeout)
  unsigned long ultimoEnvio   = 0;   // último reenvio pela UART
};
CmdRemoto cmdRemoto;

// =======================================================
// Parser UART
// =======================================================

enum RxState {
  RX_WAIT_START,
  RX_TYPE,
  RX_DATA0,
  RX_DATA1,
  RX_CHECKSUM
};

RxState rxState = RX_WAIT_START;
uint8_t rxType  = 0;
uint8_t rxData0 = 0;
uint8_t rxData1 = 0;

// =======================================================
// Filtro digital reutilizável
// =======================================================

struct FiltroDigital {
  bool          leituraAnterior  = false;
  bool          estadoFiltrado   = false;
  unsigned long instanteMudanca  = 0;
};

FiltroDigital filtroReedZ1;
FiltroDigital filtroReedZ2;
FiltroDigital filtroIrZ4;

bool atualizarFiltro(
  FiltroDigital &filtro,
  bool leituraAtual,
  unsigned long tempoFiltroMs
) {
  unsigned long agora = millis();
  if (leituraAtual != filtro.leituraAnterior) {
    filtro.leituraAnterior  = leituraAtual;
    filtro.instanteMudanca  = agora;
  }
  if (agora - filtro.instanteMudanca >= tempoFiltroMs) {
    filtro.estadoFiltrado = leituraAtual;
  }
  return filtro.estadoFiltrado;
}

// =======================================================
// UART
// =======================================================

uint8_t calcularChecksum(
  uint8_t start,
  uint8_t type,
  uint8_t data0,
  uint8_t data1
) {
  return start ^ type ^ data0 ^ data1;
}

void enviarPacote(uint8_t type, uint8_t data0, uint8_t data1) {
  const uint8_t cs = calcularChecksum(UART_START, type, data0, data1);
  Serial2.write(UART_START);
  Serial2.write(type);
  Serial2.write(data0);
  Serial2.write(data1);
  Serial2.write(cs);
}

void enviarComandoFpga(uint8_t cmd) {
  enviarPacote(TYPE_CMD_TO_FPGA, cmd, 0x00);
}

void enviarDelayParaFpga(uint8_t segundos) {
  enviarPacote(TYPE_SET_DELAY_TO_FPGA, segundos, 0x00);
}

void enviarContramedidasParaFpga() {
  uint8_t mask = 0;
  if (manualCm[0]) mask |= (1 << 0);
  if (manualCm[1]) mask |= (1 << 1);
  if (manualCm[2]) mask |= (1 << 2);
  enviarPacote(TYPE_CM_TO_FPGA, mask, 0x00);
}

void atualizarStatusFpga(uint8_t status, uint8_t zonasLatched) {
  statusFpga.armado               = (status & (1 << 0)) != 0;
  statusFpga.disparando           = (status & (1 << 1)) != 0;
  statusFpga.sireneLigada         = (status & (1 << 2)) != 0;
  statusFpga.estroboLigado        = (status & (1 << 3)) != 0;
  statusFpga.cercaHabilitada      = (status & (1 << 4)) != 0;
  statusFpga.erroComunicacaoEsp32 = (status & (1 << 5)) != 0;
  statusFpga.emAtraso             = (status & (1 << 6)) != 0;

  for (uint8_t i = 0; i < 5; i++) {
    statusFpga.zonasLatched[i] = (zonasLatched & (1 << i)) != 0;
  }
  // alertaEnviadoOk é gerenciado pela detecção de transições
}

void processarByteRecebido(uint8_t byteRecebido) {
  switch (rxState) {
    case RX_WAIT_START:
      if (byteRecebido == UART_START) rxState = RX_TYPE;
      break;
    case RX_TYPE:
      rxType  = byteRecebido;
      rxState = RX_DATA0;
      break;
    case RX_DATA0:
      rxData0 = byteRecebido;
      rxState = RX_DATA1;
      break;
    case RX_DATA1:
      rxData1 = byteRecebido;
      rxState = RX_CHECKSUM;
      break;
    case RX_CHECKSUM: {
      const uint8_t cs = calcularChecksum(UART_START, rxType, rxData0, rxData1);
      if (byteRecebido == cs) {
        if (rxType == TYPE_STATUS_FROM_FPGA) {
          atualizarStatusFpga(rxData0, rxData1);
        } else if (rxType == TYPE_DELAY_FROM_FPGA) {
          // rxData0 = delay configurado (switches SW5-SW11)
          // rxData1 = segundos restantes da temporização em andamento
          delaySecondsConfig = rxData0 & 0x7F;
          delayRemainingFpga = rxData1 & 0x7F;
        }
      }
      rxState = RX_WAIT_START;
      break;
    }
  }
}

void lerPacotesDaFpga() {
  while (Serial2.available() > 0) {
    const int valor = Serial2.read();
    if (valor >= 0) processarByteRecebido(static_cast<uint8_t>(valor));
  }
}

// =======================================================
// Sensores
// =======================================================

float medirDistanciaCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  const unsigned long duracao = pulseIn(echoPin, HIGH, TIMEOUT_ULTRASSONICO_US);
  if (duracao == 0) return 999.0;
  return duracao / 58.0;
}

bool interpretarNivelDigital(uint8_t pin, bool ativoEmHigh) {
  const bool nivelHigh = digitalRead(pin) == HIGH;
  return ativoEmHigh ? nivelHigh : !nivelHigh;
}

bool lerZona1() {
  if (!HABILITAR_ZONA_1) return false;
  const bool leitura = interpretarNivelDigital(PIN_REED_Z1, REED_ATIVO_EM_HIGH);
  return atualizarFiltro(filtroReedZ1, leitura, FILTRO_REED_MS);
}

bool lerZona2() {
  if (!HABILITAR_ZONA_2) return false;
  const bool leitura = interpretarNivelDigital(PIN_REED_Z2, REED_ATIVO_EM_HIGH);
  return atualizarFiltro(filtroReedZ2, leitura, FILTRO_REED_MS);
}

bool lerZona3() {
  if (!HABILITAR_ZONA_3) {
    sensores.pirZ3      = false;
    sensores.distanciaZ3 = 999.0;
    return false;
  }
  sensores.pirZ3       = digitalRead(PIN_PIR_Z3) == HIGH;
  sensores.distanciaZ3 = medirDistanciaCm(PIN_TRIG_Z3, PIN_ECHO_Z3);
  const bool ultrassonicoAtivo = sensores.distanciaZ3 <= DISTANCIA_LIMITE_Z3_CM;
  if (ZONA3_EXIGE_PIR_E_ULTRASSONICO) return sensores.pirZ3 && ultrassonicoAtivo;
  return sensores.pirZ3 || ultrassonicoAtivo;
}

bool lerZona4() {
  if (!HABILITAR_ZONA_4) {
    sensores.irZ4Bruto = false;
    return false;
  }
  const bool nivelHigh = digitalRead(PIN_SENSOR_IR_Z4) == HIGH;
  sensores.irZ4Bruto   = nivelHigh;
  const bool leituraInterpretada = SENSOR_IR_ATIVO_EM_HIGH ? nivelHigh : !nivelHigh;
  return atualizarFiltro(filtroIrZ4, leituraInterpretada, FILTRO_IR_Z4_MS);
}

bool lerZona5() {
  if (!HABILITAR_ZONA_5) {
    sensores.distanciaZ5 = 999.0;
    return false;
  }
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
// MQTT helpers
// =======================================================

String gerarMsgId() {
  char buf[33];
  snprintf(buf, sizeof(buf), "%08x%08x%08x%08x",
    (unsigned)esp_random(), (unsigned)esp_random(),
    (unsigned)esp_random(), (unsigned)esp_random());
  return String(buf);
}

String getIsoTime() {
  struct tm ti;
  if (!getLocalTime(&ti, 0)) return "2024-01-01T00:00:00Z";
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buf);
}

const char* modoAlarme() {
  if (statusFpga.disparando)              return "triggered";
  if (statusFpga.armado && statusFpga.emAtraso) return "pending";
  if (statusFpga.armado)                  return "armed";
  return "disarmed";
}

// =======================================================
// Publicação MQTT
// =======================================================

void publicarDisponibilidade(bool online, const char* reason) {
  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = gerarMsgId();
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = getIsoTime();
  doc["sequence"]      = (long)msgSequence++;
  doc["online"]        = online;
  doc["reason"]        = reason;

  char buf[256];
  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(TOPIC_AVAILABILITY, buf, true);
}

void publicarEstado() {
  static char buf[MQTT_BUFFER_SIZE];

  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = gerarMsgId();
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = getIsoTime();
  doc["sequence"]      = (long)msgSequence++;
  doc["mode"]          = modoAlarme();
  doc["online"]        = true;
  doc["sirenActive"]   = statusFpga.sireneLigada || manualCm[0];
  doc["delaySeconds"]  = (int)delaySecondsConfig;
  doc["triggerCount"]  = (long)triggerCount;

  // Contagem regressiva vinda direto da FPGA (fonte da verdade).
  if (statusFpga.emAtraso && !statusFpga.disparando) {
    doc["pendingSeconds"] = (int)delayRemainingFpga;
  }

  static const char* zonaNames[] = {
    "Porta Principal", "Janela", "Sala", "Corredor", "Garagem"
  };
  static const char* zonaTypes[] = {
    "Reed Switch", "Reed Switch", "PIR + Ultrassonico", "IR", "Ultrassonico"
  };

  JsonArray zones = doc["zones"].to<JsonArray>();
  for (int i = 0; i < 5; i++) {
    JsonObject z    = zones.add<JsonObject>();
    z["id"]         = i + 1;
    z["name"]       = zonaNames[i];
    z["sensorType"] = zonaTypes[i];
    z["violated"]   = statusFpga.zonasLatched[i];
  }

  JsonArray cm = doc["countermeasures"].to<JsonArray>();
  { JsonObject o = cm.add<JsonObject>(); o["id"]="sirene";  o["name"]="Sirene";         o["active"]=statusFpga.sireneLigada    || manualCm[0]; }
  { JsonObject o = cm.add<JsonObject>(); o["id"]="estrobo"; o["name"]="Estrobo";        o["active"]=statusFpga.estroboLigado   || manualCm[1]; }
  { JsonObject o = cm.add<JsonObject>(); o["id"]="cerca";   o["name"]="Cerca Eletrica"; o["active"]=statusFpga.cercaHabilitada || manualCm[2]; }

  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(TOPIC_STATE, buf, true);
}

void publicarEvento(
  const char* type,
  const char* title,
  const char* desc,
  const char* severity,
  int zoneId = -1
) {
  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = gerarMsgId();
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = getIsoTime();
  doc["sequence"]      = (long)msgSequence++;
  doc["eventId"]       = gerarMsgId();
  doc["type"]          = type;
  doc["title"]         = title;
  doc["description"]   = desc;
  doc["severity"]      = severity;
  if (zoneId > 0) doc["zoneId"] = zoneId;

  char buf[512];
  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(TOPIC_EVENTS, buf);
}

void publicarCmdAck(const char* requestId, bool accepted, const char* reason = nullptr) {
  JsonDocument doc;
  doc["schemaVersion"] = 1;
  doc["messageId"]     = gerarMsgId();
  doc["deviceId"]      = DEVICE_ID;
  doc["occurredAt"]    = getIsoTime();
  doc["sequence"]      = (long)msgSequence++;
  doc["requestId"]     = requestId;
  doc["accepted"]      = accepted;
  if (reason) doc["reason"] = reason;

  char buf[256];
  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(TOPIC_CMD_ACKS, buf);
}

// =======================================================
// MQTT callback — recebe comandos do gateway
// =======================================================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok) return;

  // ----------------------------------------------------------------------
  // Confirmação de envio das notificações (gateway -> ESP32).
  // Só aqui sabemos que e-mail/SMS/WhatsApp realmente saíram. O FPGA usa
  // a flag alertaEnviadoOk como ACK; se não chegar, o watchdog reseta o ESP32.
  // ----------------------------------------------------------------------
  if (strcmp(topic, TOPIC_NOTIFY_ACKS) == 0) {
    const char* email = doc["channels"]["email"]    | "skipped";
    const char* sms   = doc["channels"]["sms"]      | "skipped";
    const char* whats = doc["channels"]["whatsapp"] | "skipped";

    const bool algumEnviado =
      strcmp(email, "sent") == 0 ||
      strcmp(sms,   "sent") == 0 ||
      strcmp(whats, "sent") == 0;

    // Se nenhum canal remoto está configurado (todos "skipped"), não há o que
    // confirmar: aceitamos para não deixar o FPGA resetando o ESP32 em loop.
    const bool nenhumConfigurado =
      strcmp(email, "skipped") == 0 &&
      strcmp(sms,   "skipped") == 0 &&
      strcmp(whats, "skipped") == 0;

    if (algumEnviado || nenhumConfigurado) {
      alertaEnviadoOk = true;   // sinaliza o FPGA no próximo pacote 0x10
    }
    return;
  }

  const char* type      = doc["type"]      | "";
  const char* requestId = doc["requestId"] | "";

  if (strcmp(type, "ARM") == 0) {
    cmdRemoto.pendente    = true;
    cmdRemoto.cmd         = CMD_ARMAR;
    cmdRemoto.inicio      = millis();
    cmdRemoto.ultimoEnvio = 0;
    strncpy(cmdRemoto.requestId, requestId, sizeof(cmdRemoto.requestId) - 1);

  } else if (strcmp(type, "DISARM") == 0 || strcmp(type, "SILENCE") == 0) {
    cmdRemoto.pendente    = true;
    cmdRemoto.cmd         = CMD_DESARMAR;
    cmdRemoto.inicio      = millis();
    cmdRemoto.ultimoEnvio = 0;
    strncpy(cmdRemoto.requestId, requestId, sizeof(cmdRemoto.requestId) - 1);

  } else if (strcmp(type, "SET_DELAY") == 0) {
    int val = doc["value"] | 0;
    delaySetpoint         = (uint8_t)constrain(val, 0, 120);
    delaySetpointDefinido = true;
    delaySecondsConfig    = delaySetpoint;   // feedback imediato p/ o app
    enviarDelayParaFpga(delaySetpoint);      // aplica na FPGA
    ultimoEnvioDelay      = millis();
    if (requestId[0]) publicarCmdAck(requestId, true);
    if (mqttClient.connected()) publicarEstado();

  } else if (strcmp(type, "SET_COUNTERMEASURE") == 0) {
    const char* val = doc["value"] | "";
    if      (strcmp(val, "sirene")  == 0) manualCm[0] = !manualCm[0];
    else if (strcmp(val, "estrobo") == 0) manualCm[1] = !manualCm[1];
    else if (strcmp(val, "cerca")   == 0) manualCm[2] = !manualCm[2];
    enviarContramedidasParaFpga();   // aplica de verdade no hardware
    ultimoEnvioCm = millis();
    if (requestId[0]) publicarCmdAck(requestId, true);
    if (mqttClient.connected()) publicarEstado();
  }
}

// =======================================================
// Detecção de transições de estado → publica eventos MQTT
// =======================================================

void verificarTransicoes() {
  // Entrou em temporização: publica estado na hora para o app reagir rápido.
  if (statusFpga.emAtraso && !prevEmAtraso) {
    publicarEstado();
  }

  // Alarme disparou: publica o evento e AGUARDA a confirmação de envio.
  // alertaEnviadoOk só vira true quando o gateway responder em notification-acks
  // (ver mqttCallback). Enquanto isso o FPGA conta o watchdog; se a notificação
  // não sair em ~5 s, o FPGA reseta o ESP32 — exatamente o requisito do projeto.
  // As contramedidas automáticas são acionadas pela própria FPGA (OR com o manual).
  if (statusFpga.disparando && !prevDisparando) {
    triggerCount++;
    alertaEnviadoOk = false;
    publicarEvento(
      "ALARM_TRIGGERED",
      "Alarme Disparado",
      "Zona(s) violada(s) detectadas.",
      "critical"
    );
    publicarEstado();
  }

  // Alarme parou de disparar: reseta ACK. O setpoint manual do app é preservado.
  if (!statusFpga.disparando && prevDisparando) {
    alertaEnviadoOk = false;
    publicarEstado();
  }

  // Armado
  if (statusFpga.armado && !prevArmado) {
    publicarEvento("ALARM_ARMED", "Alarme Armado", "Sistema armado com sucesso.", "info");
    publicarEstado();
  }

  // Desarmado
  if (!statusFpga.armado && prevArmado) {
    publicarEvento("ALARM_DISARMED", "Alarme Desarmado", "Sistema desarmado.", "info");
    publicarEstado();
  }

  prevArmado     = statusFpga.armado;
  prevDisparando = statusFpga.disparando;
  prevEmAtraso   = statusFpga.emAtraso;
}

// =======================================================
// Comando remoto (ARM/DISARM) — closed-loop com a FPGA
// =======================================================
// Um único pacote UART pode se perder. Reenviamos o comando a cada 150 ms
// até a FPGA confirmar pelo status, ou até estourar o timeout de 3 s.

void processarComandoRemoto() {
  if (!cmdRemoto.pendente) return;

  const unsigned long agora = millis();

  bool confirmado;
  if (cmdRemoto.cmd == CMD_ARMAR) {
    confirmado = statusFpga.armado;
  } else if (cmdRemoto.cmd == CMD_DESARMAR) {
    confirmado = !statusFpga.armado && !statusFpga.disparando;
  } else {
    confirmado = true;  // reset não tem feedback de estado
  }

  const bool timeout = (agora - cmdRemoto.inicio) > 3000;

  if (confirmado || timeout) {
    cmdRemoto.pendente = false;
    if (cmdRemoto.requestId[0] && mqttClient.connected()) {
      publicarCmdAck(
        cmdRemoto.requestId,
        confirmado,
        confirmado ? nullptr : "Central nao confirmou o comando"
      );
    }
    if (confirmado && mqttClient.connected()) publicarEstado();
    memset(cmdRemoto.requestId, 0, sizeof(cmdRemoto.requestId));
    return;
  }

  if (agora - cmdRemoto.ultimoEnvio >= 150) {
    cmdRemoto.ultimoEnvio = agora;
    enviarComandoFpga(cmdRemoto.cmd);
  }
}

// =======================================================
// WiFi
// =======================================================

void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    return;
  }
  wifiConectado = false;
  Serial.print("Conectando WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    lerPacotesDaFpga();
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    Serial.println(" OK: " + WiFi.localIP().toString());
    configTime(0, 0, "pool.ntp.org");
    // Aguarda sincronização NTP (até 5 s)
    struct tm ti;
    for (int i = 0; i < 10 && !getLocalTime(&ti, 0); i++) delay(500);
    Serial.println("NTP: " + getIsoTime());
  } else {
    Serial.println(" Falha WiFi.");
  }
}

// =======================================================
// MQTT conexão
// =======================================================

void conectarMqtt() {
  if (mqttClient.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.print("Conectando MQTT...");

  char clientId[28];
  snprintf(clientId, sizeof(clientId), "esp32-%08x", (unsigned)esp_random());

  // LWT marca o dispositivo como offline se a conexão cair
  const String lwtJson =
    String("{\"schemaVersion\":1,\"messageId\":\"lwt\",\"deviceId\":\"" DEVICE_ID "\","
           "\"occurredAt\":\"") +
    getIsoTime() +
    "\",\"sequence\":0,\"online\":false,\"reason\":\"last-will\"}";

  const bool ok = mqttClient.connect(
    clientId,
    MQTT_USER, MQTT_PASS,
    TOPIC_AVAILABILITY, 1, true,
    lwtJson.c_str()
  );

  if (ok) {
    Serial.println(" OK");
    mqttClient.subscribe(TOPIC_COMMANDS, 1);
    mqttClient.subscribe(TOPIC_NOTIFY_ACKS, 1);
    publicarDisponibilidade(true, "connected");
    publicarEstado();
  } else {
    Serial.printf(" Falha rc=%d\n", mqttClient.state());
  }
}

// =======================================================
// Debug
// =======================================================

void imprimirByteBinario(uint8_t valor) {
  for (int i = 7; i >= 0; i--) Serial.print((valor >> i) & 1);
}

void imprimirDistancia(float distancia) {
  if (distancia >= 999.0) Serial.print("sem resposta");
  else { Serial.print(distancia, 1); Serial.print(" cm"); }
}

void imprimirStatusDebug() {
  Serial.println();
  Serial.println("========== DEBUG ESP32 ALARME ==========");

  Serial.print("ZONES: 0b"); imprimirByteBinario(zonasAtuais); Serial.println();
  Serial.print("FLAGS: 0b"); imprimirByteBinario(flagsAtuais); Serial.println();
  Serial.println("----------------------------------------");

  Serial.print("Zona 1 Reed GPIO33: ");
  if (!HABILITAR_ZONA_1) Serial.println("DESATIVADA");
  else Serial.println(sensores.zona1 ? "VIOLADA" : "normal");

  Serial.print("Zona 2 Reed GPIO25: ");
  if (!HABILITAR_ZONA_2) Serial.println("DESATIVADA");
  else Serial.println(sensores.zona2 ? "VIOLADA" : "normal");

  Serial.print("PIR Zona 3: ");    Serial.println(sensores.pirZ3 ? "ATIVO" : "inativo");
  Serial.print("Distancia Zona 3: "); imprimirDistancia(sensores.distanciaZ3); Serial.println();
  Serial.print("Zona 3 PIR+HC-SR04: "); Serial.println(sensores.zona3 ? "VIOLADA" : "normal");
  Serial.print("GPIO27 bruto Zona 4: "); Serial.println(sensores.irZ4Bruto ? "HIGH" : "LOW");
  Serial.print("Zona 4 IR filtrada: "); Serial.println(sensores.zona4 ? "VIOLADA" : "normal");
  Serial.print("Distancia Zona 5: "); imprimirDistancia(sensores.distanciaZ5); Serial.println();
  Serial.print("Zona 5 HC-SR04: "); Serial.println(sensores.zona5 ? "VIOLADA" : "normal");

  Serial.println("----------------------------------------");
  Serial.print("FPGA armado: ");     Serial.println(statusFpga.armado     ? "SIM" : "NAO");
  Serial.print("FPGA disparando: "); Serial.println(statusFpga.disparando ? "SIM" : "NAO");
  Serial.print("FPGA em atraso: ");  Serial.println(statusFpga.emAtraso   ? "SIM" : "NAO");
  Serial.print("Sirene: ");          Serial.println(statusFpga.sireneLigada    ? "SIM" : "NAO");
  Serial.print("Estrobo: ");         Serial.println(statusFpga.estroboLigado   ? "SIM" : "NAO");
  Serial.print("Cerca: ");           Serial.println(statusFpga.cercaHabilitada ? "SIM" : "NAO");
  Serial.print("Erro com FPGA: ");   Serial.println(statusFpga.erroComunicacaoEsp32 ? "SIM" : "NAO");

  Serial.print("Zonas travadas: ");
  bool alguma = false;
  for (uint8_t i = 0; i < 5; i++) {
    if (statusFpga.zonasLatched[i]) { Serial.print(i + 1); Serial.print(" "); alguma = true; }
  }
  if (!alguma) Serial.print("nenhuma");
  Serial.println();

  Serial.println("----------------------------------------");
  Serial.print("WiFi: ");  Serial.println(wifiConectado ? "OK" : "desconectado");
  Serial.print("MQTT: ");  Serial.println(mqttClient.connected() ? "OK" : "desconectado");
  Serial.print("Modo: ");  Serial.println(modoAlarme());
  Serial.print("Disparos: "); Serial.println(triggerCount);
  Serial.print("Hora: ");  Serial.println(getIsoTime());
  Serial.println("=========================================");
}

// =======================================================
// Setup
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial2.begin(UART_BAUD, SERIAL_8N1, UART_RX_FPGA, UART_TX_FPGA);

  pinMode(PIN_REED_Z1,       INPUT_PULLUP);
  pinMode(PIN_REED_Z2,       INPUT_PULLUP);
  pinMode(PIN_PIR_Z3,        INPUT);
  pinMode(PIN_TRIG_Z3,       OUTPUT);
  pinMode(PIN_ECHO_Z3,       INPUT);
  pinMode(PIN_SENSOR_IR_Z4,  INPUT_PULLUP);
  pinMode(PIN_TRIG_Z5,       OUTPUT);
  pinMode(PIN_ECHO_Z5,       INPUT);
  pinMode(LED_STATUS,        OUTPUT);

  digitalWrite(PIN_TRIG_Z3, LOW);
  digitalWrite(PIN_TRIG_Z5, LOW);
  digitalWrite(LED_STATUS,  LOW);

  Serial.println();
  Serial.println("ESP32 iniciado - Alarme UART + MQTT");

  wifiSecure.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);

  conectarWifi();
  conectarMqtt();
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

  // Comando remoto (ARM/DISARM): reenvia até a FPGA confirmar.
  processarComandoRemoto();

  // Reenvia o atraso do app periodicamente (robustez e caso a FPGA resete).
  if (delaySetpointDefinido && agora - ultimoEnvioDelay >= 2000) {
    ultimoEnvioDelay = agora;
    enviarDelayParaFpga(delaySetpoint);
  }

  // Reenvia as contramedidas manuais periodicamente (robustez e caso a FPGA resete).
  if (agora - ultimoEnvioCm >= 2000) {
    ultimoEnvioCm = agora;
    enviarContramedidasParaFpga();
  }

  // Manter WiFi
  if (WiFi.status() != WL_CONNECTED) {
    wifiConectado = false;
    if (agora - ultimoReconectMqtt >= 30000) {
      ultimoReconectMqtt = agora;
      conectarWifi();
    }
  }

  // Manter MQTT
  if (wifiConectado) {
    if (!mqttClient.connected() && agora - ultimoReconectMqtt >= 5000) {
      ultimoReconectMqtt = agora;
      conectarMqtt();
    }

    if (mqttClient.connected()) {
      mqttClient.loop();

      // Detectar transições e publicar eventos
      verificarTransicoes();

      // Publicar estado periodicamente
      if (agora - ultimoEstadoMqtt >= INTERVALO_ESTADO_MQTT_MS) {
        ultimoEstadoMqtt = agora;
        publicarEstado();
      }
    }
  }

  if (agora - ultimoDebug >= INTERVALO_DEBUG_MS) {
    ultimoDebug = agora;
    imprimirStatusDebug();
  }
}
