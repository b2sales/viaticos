import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { ExpenseDetailDialog } from '../components/ExpenseDetailDialog';
import { statusChipStyles, statusLabels } from '../theme';
import type {
  Client,
  Expense,
  ListResponse,
  Location,
  Project,
  Technician,
} from '../types';
import { formatDate, formatMoney, CLIENT_KIND_LABELS } from '../types';

function expenseSearchText(
  e: Expense,
  lookup: {
    clientMap: Record<string, string>;
    projectMap: Record<string, string>;
    techMap: Record<string, string>;
    locationMap: Record<string, string>;
  },
): string {
  const parts = [
    e.folio,
    e.id,
    statusLabels[e.status] ?? e.status,
    e.status,
    String(e.amount),
    e.currency,
    formatMoney(e.amount, e.currency),
    e.merchant,
    e.description,
    e.receiptDate,
    formatDate(e.receiptDate),
    lookup.clientMap[e.clientId] ?? e.clientId,
    e.clientId,
    e.kind ? CLIENT_KIND_LABELS[e.kind] : '',
    e.kind,
    e.projectId ? lookup.projectMap[e.projectId] ?? e.projectId : '',
    e.projectId,
    e.glpiTicketNumber != null ? String(e.glpiTicketNumber) : '',
    e.glpiTicketId != null ? String(e.glpiTicketId) : '',
    e.glpiTicketTitle,
    lookup.techMap[e.technicianId] ?? e.technicianId,
    e.technicianId,
    e.locationId ? lookup.locationMap[e.locationId] ?? e.locationId : '',
    e.locationId,
    e.submittedAt,
    formatDate(e.submittedAt),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function BandejaPage() {
  const api = useApi();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const lookup = useMemo(() => {
    const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const techMap = Object.fromEntries(technicians.map((t) => [t.id, t.name]));
    const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
    return { clientMap, projectMap, techMap, locationMap };
  }, [clients, projects, technicians, locations]);

  const loadMasters = useCallback(async () => {
    const [clientsRes, projectsRes, techRes, locationsRes] = await Promise.all([
        api.get<ListResponse<Client>>('/clients'),
        api.get<ListResponse<Project>>('/projects'),
        api.get<ListResponse<Technician>>('/technicians'),
        api.get<ListResponse<Location>>('/locations'),
      ]);
    setClients(clientsRes.items);
    setProjects(projectsRes.items);
    setTechnicians(techRes.items);
    setLocations(locationsRes.items);
  }, [api]);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (statusFilter === 'ALL') {
        const res = await api.get<ListResponse<Expense>>('/expenses');
        setExpenses(
          res.items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
        );
      } else if (
        statusFilter === 'APPROVED' ||
        statusFilter === 'REJECTED' ||
        statusFilter === 'IN_LIQUIDATION' ||
        statusFilter === 'PAID'
      ) {
        const res = await api.get<ListResponse<Expense>>(
          `/expenses?status=${statusFilter}`,
        );
        setExpenses(
          res.items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
        );
      } else if (statusFilter === 'PENDING' || statusFilter === 'NEEDS_INFO') {
        const res = await api.get<ListResponse<Expense>>(
          `/expenses?status=${statusFilter}&inbox=1`,
        );
        setExpenses(
          res.items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
        );
      } else {
        // INBOX (PENDING + NEEDS_INFO)
        const [expPending, expNeeds] = await Promise.all([
          api.get<ListResponse<Expense>>('/expenses?status=PENDING&inbox=1'),
          api.get<ListResponse<Expense>>('/expenses?status=NEEDS_INFO&inbox=1'),
        ]);
        setExpenses(
          [...expPending.items, ...expNeeds.items].sort((a, b) =>
            b.submittedAt.localeCompare(a.submittedAt),
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter]);

  useEffect(() => {
    void loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const filtered = useMemo(() => {
    let rows: Expense[];
    if (statusFilter === 'INBOX') {
      rows = expenses.filter(
        (e) => e.status === 'PENDING' || e.status === 'NEEDS_INFO',
      );
    } else if (
      statusFilter === 'PENDING' ||
      statusFilter === 'NEEDS_INFO' ||
      statusFilter === 'APPROVED' ||
      statusFilter === 'REJECTED' ||
      statusFilter === 'IN_LIQUIDATION' ||
      statusFilter === 'PAID'
    ) {
      rows = expenses.filter((e) => e.status === statusFilter);
    } else {
      rows = expenses;
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => expenseSearchText(e, lookup).includes(q));
  }, [expenses, statusFilter, searchQuery, lookup]);

  const columns: GridColDef<Expense>[] = [
    {
      field: 'folio',
      headerName: 'ID',
      width: 110,
      valueGetter: (_v, row) => row.folio ?? '—',
    },
    {
      field: 'status',
      headerName: 'Estado',
      width: 150,
      renderCell: ({ value }) => {
        const status = value as string;
        const style = statusChipStyles[status];
        return (
          <Chip
            size="small"
            variant="outlined"
            label={statusLabels[status] ?? status}
            sx={{
              bgcolor: style?.bgcolor,
              color: style?.color,
              borderColor: style?.borderColor,
              fontWeight: style?.fontWeight ?? 600,
            }}
          />
        );
      },
    },
    {
      field: 'amount',
      headerName: 'Monto',
      width: 120,
      valueFormatter: (value, row) => formatMoney(Number(value), row.currency),
    },
    { field: 'merchant', headerName: 'Comercio', flex: 1, minWidth: 120 },
    {
      field: 'description',
      headerName: 'Motivo',
      flex: 1,
      minWidth: 160,
    },
    {
      field: 'receiptDate',
      headerName: 'Fecha',
      width: 110,
      valueFormatter: (value) => formatDate(value as string | undefined),
    },
    {
      field: 'clientId',
      headerName: 'Cliente',
      flex: 1,
      minWidth: 120,
      valueGetter: (_v, row) => lookup.clientMap[row.clientId] ?? row.clientId,
    },
    {
      field: 'kind',
      headerName: 'Tipo',
      width: 110,
      valueGetter: (_v, row) =>
        row.kind ? CLIENT_KIND_LABELS[row.kind] : '—',
    },
    {
      field: 'projectId',
      headerName: 'Proyecto',
      flex: 1,
      minWidth: 120,
      valueGetter: (_v, row) =>
        row.projectId
          ? (lookup.projectMap[row.projectId] ?? row.projectId)
          : '—',
    },
    {
      field: 'glpiTicketNumber',
      headerName: 'GLPI',
      width: 90,
      valueGetter: (_v, row) =>
        row.glpiTicketNumber != null
          ? `#${row.glpiTicketNumber}`
          : row.glpiTicketId != null
            ? `#${row.glpiTicketId}`
            : '—',
    },
    {
      field: 'technicianId',
      headerName: 'Técnico',
      flex: 1,
      minWidth: 120,
      valueGetter: (_v, row) =>
        lookup.techMap[row.technicianId] ?? row.technicianId,
    },
    {
      field: 'locationId',
      headerName: 'Ubicación',
      flex: 1,
      minWidth: 120,
      valueGetter: (_v, row) =>
        row.locationId
          ? (lookup.locationMap[row.locationId] ?? row.locationId)
          : '—',
    },
    {
      field: 'submittedAt',
      headerName: 'Enviado',
      width: 110,
      valueFormatter: (value) => formatDate(value as string | undefined),
    },
  ];

  const selected = expenses.find((e) => e.id === selectedId);
  const readOnly =
    selected?.status === 'APPROVED' ||
    selected?.status === 'REJECTED' ||
    selected?.status === 'IN_LIQUIDATION' ||
    selected?.status === 'PAID';

  const reload = useCallback(async () => {
    await loadExpenses();
  }, [loadExpenses]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Bandeja de gastos
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ sm: 'center' }}
      >
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>Estado</InputLabel>
          <Select
            label="Estado"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="INBOX">Pendientes de aprobación + Info requerida</MenuItem>
            <MenuItem value="PENDING">Pendiente de aprobación</MenuItem>
            <MenuItem value="NEEDS_INFO">Info requerida</MenuItem>
            <MenuItem value="APPROVED">Pendiente de liquidación</MenuItem>
            <MenuItem value="IN_LIQUIDATION">En liquidación (en lote)</MenuItem>
            <MenuItem value="PAID">Liquidado / Pagado</MenuItem>
            <MenuItem value="REJECTED">Rechazado</MenuItem>
            <MenuItem value="ALL">Todos los comprobantes</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Buscar"
          placeholder="ID, técnico, comercio, cliente…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ minWidth: 280, flex: 1, maxWidth: 480 }}
        />
      </Stack>

      <DataGrid
        rows={filtered}
        columns={columns}
        loading={loading}
        autoHeight
        pageSizeOptions={[10, 25, 50]}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        onRowClick={(params) => setSelectedId(String(params.id))}
        disableRowSelectionOnClick
        sx={{ bgcolor: 'background.paper', cursor: 'pointer' }}
      />

      <ExpenseDetailDialog
        expenseId={selectedId}
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        onUpdated={() => void reload()}
        readOnly={readOnly}
        clientName={
          selected ? lookup.clientMap[selected.clientId] : undefined
        }
        projectName={
          selected?.projectId
            ? lookup.projectMap[selected.projectId]
            : undefined
        }
        technicianName={
          selected ? lookup.techMap[selected.technicianId] : undefined
        }
        locationName={
          selected?.locationId
            ? lookup.locationMap[selected.locationId]
            : undefined
        }
      />
    </Box>
  );
}
