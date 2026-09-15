/**
 * One-shot: assign sequential folios (V-000001…) to expenses missing folio.
 *
 * Usage (from repo root, after shared build, with AWS_PROFILE=ecorp):
 *   node packages/shared/dist/scripts/backfill-folios.js
 */
import { backfillExpenseFolios } from '../repos/counters.js';

const result = await backfillExpenseFolios();
console.log(`Folios asignados: ${result.assigned}`);
