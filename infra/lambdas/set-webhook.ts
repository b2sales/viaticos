import type { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});

async function getSecretString(secretId: string): Promise<string> {
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) throw new Error(`Secret ${secretId} empty`);
  return out.SecretString;
}

async function setCommands(botToken: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: 'Inicio' },
        { command: 'ayuda', description: 'Comandos disponibles' },
        { command: 'gasto', description: 'Cargar gasto sin foto' },
        { command: 'resumen', description: 'Resumen de gastos del mes' },
        { command: 'detalle', description: 'Detalle de gastos del mes' },
        { command: 'cancelar', description: 'Cancelar carga en curso' },
      ],
    }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(json.description ?? 'setMyCommands failed');
}

async function setWebhook(url: string, secretToken: string, botToken: string): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(json.description ?? 'setWebhook failed');
  await setCommands(botToken);
  return json;
}

async function deleteWebhook(botToken: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  });
}

export async function handler(
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> {
  const physicalId = event.RequestType === 'Create' ? `telegram-webhook-${Date.now()}` : event.PhysicalResourceId;
  const botToken = await getSecretString(process.env.TELEGRAM_SECRET_NAME!);
  const webhookSecret = await getSecretString(process.env.WEBHOOK_SECRET_ARN!);
  const webhookUrl = (event.ResourceProperties.WebhookUrl as string) || process.env.WEBHOOK_URL!;

  try {
    if (event.RequestType === 'Delete') {
      await deleteWebhook(botToken);
    } else {
      await setWebhook(webhookUrl, webhookSecret, botToken);
    }
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  } catch (err) {
    return {
      Status: 'FAILED',
      Reason: err instanceof Error ? err.message : String(err),
      PhysicalResourceId: physicalId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }
}
