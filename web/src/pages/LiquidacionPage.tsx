import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/es';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/useApi';
import { statusLabels } from '../theme';
import type {
  Expense,
  ListResponse,
  SettlementBatch,
  SettlementBatchDetail,
} from '../types';
import { formatDate, formatMoney } from '../types';

export function LiquidacionPage() {
  const api = useApi();
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [approved, setApproved] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<Dayjs | null>(dayjs().startOf('month'));
  const [to, setTo] = useState<Dayjs | null>(dayjs());
  const [selected, setSelected] = useState<GridRowSelectionModel>([]);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<SettlementBatchDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, a] = await Promise.all([
        api.get<ListResponse<SettlementBatch>>('/settlements'),
        api.get<ListResponse<Expense>>('/expenses?status=APPROVED'),
      ]);
      setBatches(b.items);
      setApproved(a.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setName('');
    setFrom(dayjs().startOf('month'));
    setTo(dayjs());
    setSelected([]);
    setDialogOpen(true);
  };

  const createBatch = async () => {
    if (!from || !to) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/settlements', {
        name: name || undefined,
        periodFrom: from.format('YYYY-MM-DD'),
        periodTo: to.format('YYYY-MM-DD'),
        expenseIds: selected.map(String),
      });
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear lote');
    } finally {
      setSaving(false);
    }
  };

  const closeBatch = async (id: string) => {
    if (!window.confirm('¿Cerrar lote y marcar gastos como pagados?')) return;
    setError(null);
    try {
      await api.post(`/settlements/${id}/close`, {});
      await load();
      setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cerrar');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const data = await api.get<SettlementBatchDetail>(`/settlements/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al abrir lote');
    }
  };

  const exportCsv = async (id: string) => {
    await api.download(`/settlements/${id}/export.csv`, `liquidacion-${id}.csv`);
  };

  const batchColumns: GridColDef<SettlementBatch>[] = [
    {
      field: 'name',
      headerName: 'Nombre',
      flex: 1,
      valueGetter: (_v, row) => row.name || row.id.slice(0, 8),
    },
    {
      field: 'period',
      headerName: 'Período',
      width: 200,
      valueGetter: (_v, row) => `${row.periodFrom} → ${row.periodTo}`,
    },
    { field: 'status', headerName: 'Estado', width: 110 },
    {
      field: 'count',
      headerName: 'Gastos',
      width: 90,
      valueGetter: (_v, row) => row.expenseIds.length,
    },
    {
      field: 'totals',
      headerName: 'Totales',
      flex: 1,
      valueGetter: (_v, row) =>
        Object.entries(row.totalByCurrency)
          .map(([c, n]) => formatMoney(n, c))
          .join(', ') || '—',
    },
    {
      field: 'actions',
      headerName: '',
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => void openDetail(row.id)}>
            Ver
          </Button>
          {row.status === 'DRAFT' && (
            <Button
              size="small"
              color="success"
              onClick={() => void closeBatch(row.id)}
            >
              Cerrar
            </Button>
          )}
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => void exportCsv(row.id)}
          >
            CSV
          </Button>
        </Stack>
      ),
    },
  ];

  const expenseColumns: GridColDef<Expense>[] = [
    {
      field: 'submittedAt',
      headerName: 'Fecha',
      width: 110,
      valueGetter: (_v, row) => formatDate(row.receiptDate ?? row.submittedAt),
    },
    {
      field: 'amount',
      headerName: 'Monto',
      width: 120,
      valueGetter: (_v, row) => formatMoney(row.amount, row.currency),
    },
    { field: 'merchant', headerName: 'Comercio', flex: 1 },
    { field: 'technicianId', headerName: 'Empleado', width: 120 },
  ];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h5">Liquidación</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreate}
          >
            Nuevo lote
          </Button>
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DataGrid
          rows={batches}
          columns={batchColumns}
          loading={loading}
          autoHeight
          pageSizeOptions={[10, 25]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          sx={{ bgcolor: 'background.paper', mb: 3 }}
        />

        {detail && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Lote {detail.name || detail.id.slice(0, 8)} —{' '}
              {statusLabels[detail.status] ?? detail.status}
            </Typography>
            <DataGrid
              rows={detail.expenses ?? []}
              columns={expenseColumns}
              autoHeight
              pageSizeOptions={[10]}
              initialState={{
                pagination: { paginationModel: { pageSize: 10 } },
              }}
              sx={{ bgcolor: 'background.paper' }}
            />
            <Button sx={{ mt: 1 }} onClick={() => setDetail(null)}>
              Cerrar detalle
            </Button>
          </Box>
        )}

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Nuevo lote de liquidación</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Nombre (opcional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ mt: 1, mb: 2 }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <DatePicker
                label="Desde"
                value={from}
                onChange={setFrom}
                slotProps={{ textField: { fullWidth: true } }}
              />
              <DatePicker
                label="Hasta"
                value={to}
                onChange={setTo}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Stack>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Gastos aprobados a incluir ({selected.length} seleccionados)
            </Typography>
            <DataGrid
              rows={approved}
              columns={[
                ...expenseColumns,
                {
                  field: 'sel',
                  headerName: '',
                  width: 50,
                  sortable: false,
                  renderCell: () => <Checkbox disabled checked={false} sx={{ display: 'none' }} />,
                },
              ]}
              checkboxSelection
              rowSelectionModel={selected}
              onRowSelectionModelChange={setSelected}
              autoHeight
              pageSizeOptions={[10, 25]}
              initialState={{
                pagination: { paginationModel: { pageSize: 10 } },
              }}
              sx={{ bgcolor: 'background.paper' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              variant="contained"
              onClick={() => void createBatch()}
              disabled={saving || selected.length === 0 || !from || !to}
            >
              Crear lote
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}
