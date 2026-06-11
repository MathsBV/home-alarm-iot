# Matriz de rastreabilidade

| Requisito do projeto | Implementação |
| --- | --- |
| Estado armado, desarmado e disparado | Cartão principal do dashboard e campo MQTT `mode` |
| Cinco zonas identificáveis | Grade de cinco zonas com nome, sensor e violação |
| Atraso de 0 a 120 segundos | Controle `SET_DELAY` validado no app, gateway e contrato |
| Alertar usuários cadastrados | Contatos por residência, push Expo, e-mail Resend e SMS Twilio |
| Dashboard com informações relevantes | Estado, zonas, ESP32, sirene, contramedidas e contadores |
| Histórico em banco/nuvem | Eventos persistidos no Firestore |
| Dados exploráveis no Power BI | Endpoints autenticados de exportação CSV e JSON |
| Armar/desarmar remotamente | Comandos MQTT enviados somente pelo gateway |
| Comando por voz | Reconhecimento em português no Development Build, com confirmação por PIN |
| Confirmação ao FPGA após alertas | Tópico MQTT `notification-acks` |
| Mitigação de travamento | Heartbeat, Last Will, reconexão MQTT e confirmação para watchdog |
| Duas contramedidas | Luz estroboscópica e gerador de névoa configuráveis |
| Documentação rastreável | README, contrato MQTT, testes e esta matriz |

## Limitação declarada

O comando de voz está dentro do aplicativo. Alexa e Google Assistente não fazem parte desta versão e precisam ser validados com o professor como atendimento parcial do requisito.
