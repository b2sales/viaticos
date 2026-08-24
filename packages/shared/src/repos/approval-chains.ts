import { getItem, putItem, scan } from '../dynamodb/helpers.js';
import { TABLE_NAMES, type ApprovalChain, type ApprovalChainStep } from '../types/index.js';

export async function getApprovalChain(
  submitterRoleId: string,
): Promise<ApprovalChain | undefined> {
  return getItem<ApprovalChain>({
    TableName: TABLE_NAMES.approvalChains,
    Key: { submitterRoleId },
  });
}

export async function listApprovalChains(): Promise<ApprovalChain[]> {
  return scan<ApprovalChain>({ TableName: TABLE_NAMES.approvalChains });
}

export async function upsertApprovalChain(
  submitterRoleId: string,
  steps: ApprovalChainStep[],
): Promise<ApprovalChain> {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const chain: ApprovalChain = {
    submitterRoleId,
    steps: sorted,
    updatedAt: new Date().toISOString(),
  };
  await putItem({ TableName: TABLE_NAMES.approvalChains, Item: chain });
  return chain;
}
