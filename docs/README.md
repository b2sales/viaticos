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
- `viaticos/entra-config` — `{ tenantId, clientId, clientSecret, adminGroupId, supervisorGroupId, liquidacionGroupId }`
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

### Configurar Entra ID (panel web + Graph)

El acceso al panel se define por **grupos de Microsoft Entra**, no por registros manuales en la app:

| Grupo Entra | Permisos en el panel |
|-------------|----------------------|
| `Viaticos-Admins` | Admin general (todo) |
| `Viaticos-Supervisores` | Supervisor (bandeja, maestros, técnicos de su equipo) |
| `Viaticos-Liquidacion` | Liquidación + consolidados |

Actualizar el secreto (perfil `ecorp`):

```bash
export AWS_PROFILE=ecorp
aws secretsmanager put-secret-value \
  --secret-id viaticos/entra-config \
  --secret-string '{
    "tenantId":"5895d415-3e31-4352-87ff-a3bbf1017bc8",
    "clientId":"d90e8823-9795-4491-9586-3df2bf6622b0",
    "clientSecret":"...",
    "adminGroupId":"59c177f8-d594-4803-a4a2-4ae3749c3f40",
    "supervisorGroupId":"OBJECT-ID-Viaticos-Supervisores",
    "liquidacionGroupId":"OBJECT-ID-Viaticos-Liquidacion"
  }'
```

En la app registration de Entra, estos permisos **delegados** de Microsoft Graph deben tener consentimiento de administrador:

- `GroupMember.Read.All` — listar miembros del grupo supervisores
- `User.ReadBasic.All` — leer nombre y email de esos usuarios (sin esto Graph devuelve solo el Object ID)

El dropdown de supervisores en **Técnicos** consulta Graph **desde el navegador** (la app es SPA y no usa client secret en el servidor).

Variable de build del panel: `VITE_ENTRA_SUPERVISOR_GROUP_ID` (Object ID del grupo `Viaticos-Supervisores`).

Si una persona es admin y también supervisa un equipo, agregala a **Viaticos-Admins** y **Viaticos-Supervisores**; el panel usa permisos de admin y puede asignarse como supervisor de técnicos.

## Primer uso

1. Abrí https://viaticos.ecorp.com.ar e iniciá sesión con Microsoft (miembro de `Viaticos-Admins`, `Viaticos-Supervisores` o `Viaticos-Liquidacion`).
2. En **Roles**, revisá los perfiles seed y las cadenas de aprobación.
3. En **Técnicos**, creá técnicos de campo (solo bot Telegram): nombre, supervisor (dropdown desde Entra) y palabra clave.
4. Supervisores (grupo Entra) gestionan su equipo de técnicos, clientes/proyectos y bandeja.
5. Cualquier técnico activo informa gastos por el bot Telegram.
6. La bandeja muestra gastos del paso de aprobación que te corresponde (supervisores: solo su equipo).
7. Perfil **Liquidación** (grupo Entra): armar lotes de gastos aprobados y cerrarlos como pagados.

Para obtener el Telegram user id: el técnico escribe al bot `@userinfobot` o mirá CloudWatch logs del webhook al hacer `/start` (responderá “no habilitado” hasta estar registrado).

## Arquitectura

- Lambda bot: Textract `DetectDocumentText` + Bedrock Nova Micro + wizard Telegram
- Lambda API: JWT Entra ID + roles/capabilities en DynamoDB + liquidación + GLPI opcional
- DynamoDB on-demand (empleados, roles, cadenas, lotes, gastos), S3 recibos, CloudFront + ACM + Route53 (`viaticos.ecorp.com.ar`)

### Roles y aprobación

- Roles configurables con capabilities (`canApprove`, `canManageTeam`, `canManageMasters`, `canConfigureRoles`, `canLiquidate`).
- Cadenas de aprobación N pasos: qué rol aprueba a qué rol remitente.
- Acceso al panel: grupos Entra (`Viaticos-Admins`, `Viaticos-Supervisores`, `Viaticos-Liquidacion`).
- Técnicos con `managerEntraOid` (Object ID del supervisor en Entra) para ruteo de bandeja y “Mi equipo”.
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
