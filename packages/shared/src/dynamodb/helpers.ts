import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DeleteCommandInput,
  type GetCommandInput,
  type PutCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_REGION = process.env.AWS_REGION ?? 'us-east-1';

let docClient: DynamoDBDocumentClient | undefined;

export function createDynamoDbClient(config?: DynamoDBClientConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({ region: DEFAULT_REGION, ...config });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    docClient = createDynamoDbClient();
  }
  return docClient;
}

export async function getItem<T>(input: GetCommandInput): Promise<T | undefined> {
  const result = await getDocClient().send(new GetCommand(input));
  return result.Item as T | undefined;
}

export async function putItem(input: PutCommandInput): Promise<void> {
  await getDocClient().send(new PutCommand(input));
}

export async function updateItem(input: UpdateCommandInput): Promise<void> {
  await getDocClient().send(new UpdateCommand(input));
}

export async function scanItems<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let lastKey: ScanCommandInput['ExclusiveStartKey'];

  do {
    const result = await getDocClient().send(
      new ScanCommand({ ...input, ExclusiveStartKey: lastKey }),
    );
    items.push(...((result.Items ?? []) as T[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

export async function deleteItem(input: DeleteCommandInput): Promise<void> {
  await getDocClient().send(new DeleteCommand(input));
}

export async function query<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let lastEvaluatedKey: QueryCommandInput['ExclusiveStartKey'];

  do {
    const result = await getDocClient().send(
      new QueryCommand({
        ...input,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

/** @deprecated Use `query` instead */
export const queryItems = query;

export async function scan<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let lastEvaluatedKey: ScanCommandInput['ExclusiveStartKey'];

  do {
    const result = await getDocClient().send(
      new ScanCommand({
        ...input,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

export function generateId(): string {
  return uuidv4();
}

export function pk(id: string): { pk: string; sk: string } {
  return { pk: id, sk: id };
}
