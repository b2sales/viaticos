# Sistema Viáticos

Monorepo TypeScript serverless: bot Telegram + panel admin en AWS.

## URLs (prod)

| Recurso | URL |
|---------|-----|
| Panel admin | https://viaticos.ecorp.com.ar |
| API health | https://viaticos.ecorp.com.ar/api/health |
| Telegram webhook | configurado automáticamente en deploy |

## Perfiles CLI

```bash
export AWS_PROFILE=ecorp
export AZURE_CONFIG_DIR=~/.azure-ecorp
```

## Deploy

```bash
export AWS_PROFILE=ecorp
export CDK_DEFAULT_ACCOUNT=571170832142
export CDK_DEFAULT_REGION=us-east-1
npm install
npm run build
cd infra && npx cdk deploy ViaticosStack --require-approval never
```

## Secrets (Secrets Manager)

- `viaticos/telegram-bot-token`
- `viaticos/entra-config` — `{ tenantId, clientId, adminGroupId }`
- `viaticos/telegram-webhook-secret` — generado por CDK
- `viaticos/glpi-config` — `{ baseUrl, appToken, userToken }` (GLPI 10; `baseUrl` termina en `/apirest.php` y debe ser alcanzable por HTTPS desde la Lambda)

### Configurar credenciales GLPI (bot + panel)

Bot y API comparten el mismo secreto en **AWS Secrets Manager** (`viaticos/glpi-config`). No hay credenciales separadas para el bot.

1. En GLPI: **Configuración → General → API** → crear cliente API y copiar **App-Token**.
2. En GLPI: perfil del usuario de servicio → **Claves de acceso remoto** → generar **User token**.
3. Actualizar el secreto (perfil `ecorp`):

```bash
export AWS_PROFILE=ecorp
aws secretsmanager put-secret-value \
  --secret-id viaticos/glpi-config \
  --secret-string '{"baseUrl":"https://TU-GLPI/apirest.php","appToken":"...","userToken":"..."}'
```

4. Verificar (debe responder 200 y un `session_token`):

```bash
# Reemplazá tokens; no commitear
curl -s -H "App-Token: APP" -H "Authorization: user_token USER" \
  "https://TU-GLPI/apirest.php/initSession"
```

Si `initSession` devuelve 401, el bot no puede validar tickets (mostrará error de conexión/credenciales).

## Primer uso

1. Abrí https://viaticos.ecorp.com.ar e iniciá sesión con Microsoft (grupo `Viaticos-Admins` = administrador general bootstrap).
2. En **Roles**, revisá los perfiles seed (Técnico, Supervisor, Admin general, Liquidación) y las cadenas de aprobación.
3. En **Empleados**, creá usuarios con `telegramUserId`, `roleId` y opcionalmente `entraOid` (para panel web) y `managerId` (jefe).
4. Supervisores con Entra OID pueden cargar técnicos de su equipo y gestionar clientes/proyectos.
5. Cualquier empleado activo informa gastos por el bot Telegram.
6. La bandeja muestra solo gastos del paso de aprobación que te corresponde.
7. Perfil **Liquidación**: armar lotes de gastos aprobados y cerrarlos como pagados.

Para obtener el Telegram user id: el técnico escribe al bot `@userinfobot` o mirá CloudWatch logs del webhook al hacer `/start` (responderá “no habilitado” hasta estar registrado).

## Arquitectura

- Lambda bot: Textract `DetectDocumentText` + Bedrock Nova Micro + wizard Telegram
- Lambda API: JWT Entra ID + roles/capabilities en DynamoDB + liquidación + GLPI opcional
- DynamoDB on-demand (empleados, roles, cadenas, lotes, gastos), S3 recibos, CloudFront + ACM + Route53 (`viaticos.ecorp.com.ar`)

### Roles y aprobación

- Roles configurables con capabilities (`canApprove`, `canManageTeam`, `canManageMasters`, `canConfigureRoles`, `canLiquidate`).
- Cadenas de aprobación N pasos: qué rol aprueba a qué rol remitente.
- Empleados con `managerId` para ruteo de bandeja; supervisores gestionan su equipo.
- Liquidación: lotes DRAFT → CLOSED (gastos `APPROVED` → `IN_LIQUIDATION` → `PAID`).

## Workspaces

| Paquete | Rol |
|---------|-----|
| `@viaticos/shared` | Tipos, DynamoDB, Telegram, OCR, auth Entra, cliente GLPI |
| `@viaticos/bot` | Webhook Telegram |
| `@viaticos/api` | REST admin |
| `@viaticos/infra` | CDK |
| `@viaticos/web` | SPA React + MUI + MSAL |

## Desarrollo web local

```bash
npm run dev:web
# Proxy /api → API Gateway o ajustá vite.config.ts
```
