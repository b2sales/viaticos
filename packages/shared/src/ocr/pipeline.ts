import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DetectDocumentTextCommand, TextractClient } from '@aws-sdk/client-textract';
import type { ExpenseSuggestion } from '../types/index.js';

const DEFAULT_REGION = process.env.AWS_REGION ?? 'us-east-1';
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-micro-v1:0';

export interface OcrExtractResult {
  rawText: string;
  suggestion: ExpenseSuggestion | null;
}

export async function detectDocumentText(s3Bucket: string, s3Key: string): Promise<string> {
  const client = new TextractClient({ region: DEFAULT_REGION });
  const response = await client.send(
    new DetectDocumentTextCommand({
      Document: {
        S3Object: {
          Bucket: s3Bucket,
          Name: s3Key,
        },
      },
    }),
  );

  const lines =
    response.Blocks?.filter((block) => block.BlockType === 'LINE' && block.Text)
      .map((block) => block.Text as string) ?? [];

  return lines.join('\n');
}

export async function interpretWithBedrock(ocrText: string): Promise<ExpenseSuggestion | null> {
  if (!ocrText.trim()) {
    return null;
  }

  const client = new BedrockRuntimeClient({ region: DEFAULT_REGION });
  const prompt = [
    'Extraé datos de este ticket/factura argentino.',
    'Respondé SOLO con JSON válido sin markdown:',
    '{"amount": number|null, "date": "YYYY-MM-DD"|null, "merchant": string|null, "currency": "ARS"|null, "confidence": number}',
    'confidence es 0-1 según certeza.',
    '',
    'Texto OCR:',
    ocrText.slice(0, 4000),
  ].join('\n');

  const body = JSON.stringify({
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 256,
      temperature: 0.1,
    },
  });

  const response = await client.send(
    new InvokeModelCommand({
      modelId: DEFAULT_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }),
  );

  const responseText = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(responseText) as {
    output?: { message?: { content?: Array<{ text?: string }> } };
    content?: Array<{ text?: string }>;
  };

  const text =
    parsed.output?.message?.content?.[0]?.text ??
    parsed.content?.[0]?.text ??
    responseText;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  const suggestion = JSON.parse(jsonMatch[0]) as ExpenseSuggestion;
  return {
    amount: suggestion.amount ?? undefined,
    date: suggestion.date ?? undefined,
    merchant: suggestion.merchant ?? undefined,
    currency: suggestion.currency ?? undefined,
    confidence: suggestion.confidence ?? undefined,
  };
}

export async function processReceipt(
  bucket: string,
  key: string,
): Promise<OcrExtractResult> {
  try {
    const rawText = await detectDocumentText(bucket, key);
    let suggestion: ExpenseSuggestion | null = null;
    try {
      suggestion = await interpretWithBedrock(rawText);
    } catch {
      suggestion = null;
    }
    return { rawText, suggestion };
  } catch {
    return { rawText: '', suggestion: null };
  }
}

/** @deprecated Use processReceipt instead */
export async function extractReceiptData(options: {
  s3Key: string;
  bucket?: string;
}): Promise<OcrExtractResult & { confidence: number }> {
  const bucket = options.bucket ?? process.env.RECEIPTS_BUCKET ?? '';
  const result = await processReceipt(bucket, options.s3Key);
  return {
    ...result,
    confidence: result.suggestion?.confidence ?? 0,
  };
}
