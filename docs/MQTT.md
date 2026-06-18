# Contrato MQTT do alarme

## Conexão

- Broker: HiveMQ Cloud.
- Transporte: MQTT 3.1.1 ou MQTT 5 sobre TLS, porta `8883`.
- QoS: `1` para todos os tópicos do projeto.
- Prefixo: `home-alarm/v1/{deviceId}`.
- O `deviceId` deve ser estável e igual ao vinculado à residência no aplicativo.
- Datas usam ISO 8601 em UTC.
- O ESP32 mantém um contador `sequence` crescente durante sua execução.

## Tópicos

| Tópico | Publicador | Retido | Uso |
| --- | --- | --- | --- |
| `availability` | ESP32 | sim | Online, heartbeat e Last Will |
| `state` | ESP32 | sim | Fotografia completa da central |
| `events` | ESP32 | não | Violações e disparos |
| `commands` | Gateway | não | Controle remoto |
| `command-acks` | ESP32 | não | Resultado de cada comando |
| `notification-acks` | Gateway | não | Resultado dos alertas externos |

## Last Will

Ao conectar, o ESP32 configura em `availability` uma mensagem retida com:

```json
{
  "schemaVersion": 1,
  "messageId": "uuid",
  "deviceId": "alarm-demo-001",
  "occurredAt": "2026-06-10T18:00:00.000Z",
  "sequence": 10,
  "online": false,
  "reason": "last-will"
}
```

Após conectar, publica `online: true` com `reason: "connected"` e repete um heartbeat a cada 15 segundos.

## Estado

O payload de `state` sempre contém exatamente cinco zonas e pelo menos duas contramedidas:

```json
{
  "schemaVersion": 1,
  "messageId": "uuid",
  "deviceId": "alarm-demo-001",
  "occurredAt": "2026-06-10T18:00:00.000Z",
  "sequence": 11,
  "mode": "armed",
  "online": true,
  "sirenActive": false,
  "delaySeconds": 30,
  "triggerCount": 2,
  "zones": [
    { "id": 1, "name": "Porta", "sensorType": "Reed switch", "violated": false },
    { "id": 2, "name": "Sala", "sensorType": "PIR", "violated": false },
    { "id": 3, "name": "Garagem", "sensorType": "Ultrassom", "violated": false },
    { "id": 4, "name": "Corredor", "sensorType": "Infravermelho", "violated": false },
    { "id": 5, "name": "Quintal", "sensorType": "Laser", "violated": false }
  ],
  "countermeasures": [
    { "id": "strobe", "name": "Luz estroboscópica", "active": false },
    { "id": "fog", "name": "Gerador de névoa", "active": false }
  ]
}
```

`mode` aceita `disarmed`, `armed`, `pending`, `triggered` ou `silenced`. Durante `pending`, incluir `pendingSeconds`.

## Comandos

Tipos aceitos:

- `ARM`
- `DISARM`
- `SET_DELAY`, com valor inteiro de `0` a `120`
- `SILENCE`
- `SET_COUNTERMEASURE`, com o identificador da contramedida

O ESP32 ignora comandos após `expiresAt` e sempre responde em `command-acks`, usando o mesmo `requestId`.

## Eventos e watchdog

Cada ocorrência lógica possui um `eventId` único. Reenvios mantêm o mesmo identificador para permitir deduplicação.

Quando `ALARM_TRIGGERED` é recebido, o gateway tenta push, e-mail, SMS e WhatsApp. Depois publica `notification-acks` com o resultado por canal (`push`/`email`/`sms`/`whatsapp` = `sent`/`failed`/`skipped`). O ESP32 assina esse tópico e só marca `alertaEnviadoOk` (ACK ao FPGA, via FLAGS bit1 do pacote `0x10`) quando pelo menos um canal remoto sai como `sent` — ou quando todos estão `skipped` (nada configurado). Se a confirmação não chegar no limite do hardware (~5 s), o FPGA reinicia o ESP32 conforme o watchdog do projeto.
