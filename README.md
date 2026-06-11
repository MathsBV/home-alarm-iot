# Alarme Residencial IoT

Aplicativo React Native/Expo e gateway MQTT para a central de alarme FPGA/ESP32 do projeto final de Sistemas Embarcados.

## Arquitetura

```mermaid
flowchart LR
  FPGA["FPGA / 5 zonas"] <--> ESP32
  ESP32 <-->|"MQTT TLS"| HiveMQ["HiveMQ Cloud"]
  HiveMQ <--> Gateway["Gateway Node.js"]
  Gateway <--> Firestore["Firebase Auth + Firestore"]
  Gateway --> Expo["Expo Push"]
  Gateway --> Resend["Resend / e-mail"]
  Gateway --> Twilio["Twilio / SMS"]
  Mobile["App Expo / Android"] <-->|"HTTPS + token Firebase"| Gateway
```

O celular nunca recebe a senha do broker. Toda operação crítica passa pelo gateway, que valida o token Firebase, a associação à residência e o PIN antes de publicar MQTT.

## Estrutura

- `apps/mobile`: aplicativo Expo Router.
- `apps/gateway`: API Express, cliente MQTT, alertas e simulador ESP32.
- `packages/contracts`: schemas Zod e tipos compartilhados.
- `docs/MQTT.md`: contrato que deve ser implementado no ESP32.
- `docs/REQUIREMENTS.md`: rastreabilidade dos requisitos do PDF.

## Execução local em modo demonstração

Requisitos: Node.js 22 ou superior e um celular com Expo Go na mesma rede do computador.

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo do gateway:

   ```bash
   cp .env.example .env
   ```

   Mantenha `DEMO_MODE=true`. MQTT e Firebase podem ficar vazios.

3. Inicie o gateway:

   ```bash
   npm run dev:gateway
   ```

4. Descubra o IP local do computador e crie `apps/mobile/.env`:

   ```env
   EXPO_PUBLIC_API_URL=http://SEU_IP_LOCAL:3000
   EXPO_PUBLIC_DEMO_MODE=true
   EXPO_PUBLIC_DEMO_HOME_ID=home-demo-001
   ```

5. Inicie o app:

   ```bash
   npm run dev:mobile
   ```

6. Abra no Expo Go, conclua a configuração e use o PIN `1234`.

No modo demo, a tela Ajustes contém o botão **Simular disparo na Zona 1**. O dashboard atualiza automaticamente a cada quatro segundos.

## Configuração dos serviços reais

### Firebase

1. Crie um projeto Firebase.
2. Ative Authentication com e-mail/senha e crie os usuários.
3. Crie o Firestore.
4. Instale a Firebase CLI e publique regras e índices:

   ```bash
   firebase deploy --only firestore
   ```

5. Crie uma Service Account e preencha no `.env` do gateway:

   ```env
   FIREBASE_PROJECT_ID=...
   FIREBASE_CLIENT_EMAIL=...
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```

6. Copie a configuração do aplicativo Web do Firebase para `apps/mobile/.env`.
7. Defina `DEMO_MODE=false` e `EXPO_PUBLIC_DEMO_MODE=false`.

O primeiro login deve ser criado no Firebase Console. Ao abrir o app sem residência vinculada, o fluxo solicita nome, `deviceId` e PIN.

### HiveMQ Cloud

Crie credenciais distintas:

- ESP32: publicar `availability`, `state`, `events`, `command-acks`; ler `commands` e `notification-acks`.
- Gateway: ler os tópicos de todos os dispositivos e publicar `commands` e `notification-acks`.

Configure:

```env
MQTT_URL=mqtts://SEU_CLUSTER.hivemq.cloud:8883
MQTT_USERNAME=...
MQTT_PASSWORD=...
```

O firmware deve seguir integralmente [docs/MQTT.md](docs/MQTT.md).

### Alertas

```env
RESEND_API_KEY=...
RESEND_FROM=Alarme Residencial <alarme@seu-dominio.com>
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+...
```

Contas Twilio em avaliação geralmente enviam SMS somente a números verificados. Sem credenciais, o gateway registra o canal como `skipped` e continua os demais.

## Development Build e APK

O Expo Go executa as telas e o fluxo demo, mas push remoto e reconhecimento de voz exigem compilação nativa.

1. Instale e autentique o EAS CLI:

   ```bash
   npm install --global eas-cli
   eas login
   ```

2. Dentro de `apps/mobile`, vincule o projeto:

   ```bash
   eas init
   ```

3. Gere um APK de desenvolvimento:

   ```bash
   eas build --platform android --profile development
   ```

4. Gere o APK de apresentação:

   ```bash
   eas build --platform android --profile preview
   ```

Após `eas init`, o valor real de `extra.eas.projectId` substituirá o placeholder em `app.json`.

## Gateway no Render

O arquivo `render.yaml` cria o serviço e lista os segredos necessários. O plano gratuito suspende o processo após quinze minutos sem tráfego HTTP; enquanto suspenso, ele não recebe mensagens MQTT. Antes da apresentação, acesse `/health` e confirme:

```json
{
  "status": "ok",
  "mode": "production",
  "firebase": true,
  "mqtt": true
}
```

Para disponibilidade real, use uma instância sempre ativa.

## Simulador ESP32

Com o broker configurado no `.env`:

```bash
npm run dev:simulator
```

Comandos no terminal:

- `v`: viola a Zona 1 e dispara o alarme quando armado.
- `r`: restaura os sensores.
- `q`: encerra corretamente.

O simulador recebe comandos do app, responde `command-acks`, publica estado retido, heartbeat e Last Will.

## Testes

```bash
npm test
npm run typecheck
npm run build
```

Teste integrado recomendado:

1. Inicie gateway e simulador.
2. Arme pelo aplicativo com PIN.
3. Digite `v` no simulador.
4. Confirme estado disparado, Zona 1 violada e evento no histórico.
5. Confirme nos logs o envio dos alertas e a publicação de `notification-acks`.
6. Silencie e desarme pelo aplicativo.

## Exportação para Power BI

O gateway disponibiliza:

- `GET /api/homes/{homeId}/events/export?format=csv`
- `GET /api/homes/{homeId}/events/export?format=json`

Ambos exigem `Authorization: Bearer <Firebase ID token>`. Para integração duradoura com Power BI, crie no gateway uma credencial de serviço específica; não armazene a senha do HiveMQ no Power BI.

## Segurança e limitações

- PIN armazenado como hash bcrypt com `PIN_PEPPER`.
- Credenciais externas ficam somente no gateway.
- Mensagens MQTT são validadas por schema e eventos são deduplicados por `eventId`.
- O reconhecimento de voz apenas prepara o comando; o PIN continua obrigatório.
- Alexa/Google Assistente não estão implementados nesta versão.
- Contramedidas físicas devem obedecer às exigências legais e de segurança do projeto. O software não substitui intertravamentos elétricos no FPGA.
