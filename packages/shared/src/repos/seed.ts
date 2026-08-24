import { upsertApprovalChain } from './approval-chains.js';
import { createRole, getRoleById } from './roles.js';
import { generateId, putItem } from '../dynamodb/helpers.js';
import { SEED_ROLE_IDS, TABLE_NAMES, type RoleCapabilities } from '../types/index.js';

const TECH_CAPS: RoleCapabilities = {
  canApprove: false,
  canLiquidate: false,
  canManageMasters: false,
  canManageTeam: false,
  canConfigureRoles: false,
};

const SUPERVISOR_CAPS: RoleCapabilities = {
  canApprove: true,
  canLiquidate: false,
  canManageMasters: true,
  canManageTeam: true,
  canConfigureRoles: false,
};

const ADMIN_CAPS: RoleCapabilities = {
  canApprove: true,
  canLiquidate: true,
  canManageMasters: true,
  canManageTeam: true,
  canConfigureRoles: true,
};

const LIQUIDACION_CAPS: RoleCapabilities = {
  canApprove: false,
  canLiquidate: true,
  canManageMasters: false,
  canManageTeam: false,
  canConfigureRoles: false,
};

let seedPromise: Promise<void> | undefined;

/**
 * Idempotent seed of default roles and approval chains.
 * Safe to call on every API cold start / request.
 */
export async function ensureSeedRolesAndChains(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const seeds: {
        id: string;
        name: string;
        capabilities: RoleCapabilities;
      }[] = [
        { id: SEED_ROLE_IDS.tecnico, name: 'Técnico', capabilities: TECH_CAPS },
        {
          id: SEED_ROLE_IDS.supervisor,
          name: 'Supervisor',
          capabilities: SUPERVISOR_CAPS,
        },
        {
          id: SEED_ROLE_IDS.admin,
          name: 'Admin general',
          capabilities: ADMIN_CAPS,
        },
        {
          id: SEED_ROLE_IDS.liquidacion,
          name: 'Liquidación',
          capabilities: LIQUIDACION_CAPS,
        },
      ];

      for (const seed of seeds) {
        const existing = await getRoleById(seed.id);
        if (!existing) {
          await createRole({
            id: seed.id,
            name: seed.name,
            active: true,
            capabilities: seed.capabilities,
          });
        }
      }

      // Only seed chains if roles exist; upsert is idempotent for defaults
      // when chains table is empty for these submitters — check first
      const { getApprovalChain } = await import('./approval-chains.js');
      const techChain = await getApprovalChain(SEED_ROLE_IDS.tecnico);
      if (!techChain) {
        await upsertApprovalChain(SEED_ROLE_IDS.tecnico, [
          { order: 0, approverRoleId: SEED_ROLE_IDS.supervisor },
        ]);
      }
      const supChain = await getApprovalChain(SEED_ROLE_IDS.supervisor);
      if (!supChain) {
        await upsertApprovalChain(SEED_ROLE_IDS.supervisor, [
          { order: 0, approverRoleId: SEED_ROLE_IDS.admin },
        ]);
      }

      await ensureSeedMotives();
    })().catch((err) => {
      seedPromise = undefined;
      throw err;
    });
  }
  await seedPromise;
}

const DEFAULT_MOTIVES = [
  'Combustible',
  'Peaje',
  'Comida',
  'Hotel',
  'Estacionamiento',
  'Transporte',
  'Insumos',
  'Otros',
];

async function ensureSeedMotives(): Promise<void> {
  const { listMotives } = await import('./motives.js');
  const existing = await listMotives();
  if (existing.length > 0) return;

  const ts = new Date().toISOString();
  for (let i = 0; i < DEFAULT_MOTIVES.length; i++) {
    await putItem({
      TableName: TABLE_NAMES.expenseMotives,
      Item: {
        id: generateId(),
        label: DEFAULT_MOTIVES[i],
        sortOrder: i,
        active: true,
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
}
