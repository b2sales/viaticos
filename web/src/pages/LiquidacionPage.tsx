import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/es';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { statusLabels } from '../theme';
import type {
  Client,
  Expense,
  ExpenseDetail,
  ListResponse,
  Location,
  Project,
  SettlementBatch,
  SettlementBatchDetail,
  Technician,
} from '../types';
import { CLIENT_KIND_LABELS, formatDate, formatMoney } from '../types';

export function LiquidacionPage() {
  const api = useApi();
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [approved, setApproved] = useState<Expense[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selección múltiple para lote
  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>([]);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [batchFrom, setBatchFrom] = useState<Dayjs | null>(dayjs().startOf('month'));
  const [batchTo, setBatchTo] = useState<Dayjs | null>(dayjs());
  const [savingBatch, setSavingBatch] = useState(false);

  // Liquidación individual
  const [singleExpenseToLiquidate, setSingleExpenseToLiquidate] = useState<Expense | null>(null);
  const [savingSingle, setSavingSingle] = useState(false);

  // Visor de foto (Ojo)
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoTitle, setPhotoTitle] = useState('');
  const [photoZoom, setPhotoZoom] = useState(1);

  // Detalle de lote
  const [detail, setDetail] = useState<SettlementBatchDetail | null>(null);

  const lookup = useMemo(() => {
    const clientMap = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const techMap = Object.fromEntries(technicians.map((t) => [t.id, t.name]));
    const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
    return { clientMap, projectMap, techMap, locationMap };
  }, [clients, projects, technicians, locations]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, a, c, p, t, l] = await Promise.all([
        api.get<ListResponse<SettlementBatch>>('/settlements'),
        api.get<ListResponse<Expense>>('/expenses?status=APPROVED'),
        api.get<ListResponse<Client>>('/clients'),
        api.get<ListResponse<Project>>('/projects'),
        api.get<ListResponse<Technician>>('/technicians'),
        api.get<ListResponse<Location>>('/locations'),
      ]);
      setBatches(b.items);
      setApproved(a.items.sort((x, y) => (y.receiptDate ?? y.submittedAt).localeCompare(x.receiptDate ?? x.submittedAt)));
      setClients(c.items);
      setProjects(p.items);
      setTechnicians(t.items);
      setLocations(l.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Abrir modal de foto
  const handleViewPhoto = async (expense: Expense) => {
    setPhotoLoading(true);
    setPhotoUrl(null);
    setPhotoZoom(1);
    setPhotoTitle(`Comprobante - ${expense.merchant || 'Gasto'} (${formatMoney(expense.amount, expense.currency)})`);
    setPhotoDialogOpen(true);
    try {
      const data = await api.get<ExpenseDetail>(`/expenses/${expense.id}`);
      setPhotoUrl(data.receiptUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al obtener comprobante');
    } finally {
      setPhotoLoading(false);
    }
  };

  // Descargar foto/comprobante directamente
  const handleDownloadReceipt = async (expense: Expense) => {
    try {
      const data = await api.get<ExpenseDetail>(`/expenses/${expense.id}`);
      if (!data.receiptUrl) {
        alert('Este comprobante no tiene imagen adjunta.');
        return;
      }
      const response = await fetch(data.receiptUrl);
      const blob = await response.blob();
      const ext = data.receiptS3Key?.split('.').pop() || 'jpg';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `comprobante-${expense.id}.${ext}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al descargar comprobante');
    }
  };

  // Liquidación individual
  const handleConfirmSingleLiquidate = async () => {
    if (!singleExpenseToLiquidate) return;
    setSavingSingle(true);
    setError(null);
    try {
      const exp = singleExpenseToLiquidate;
      const receiptDay = exp.receiptDate ? dayjs(exp.receiptDate) : dayjs(exp.submittedAt);
      await api.post('/settlements', {
        name: `Liquidación individual - ${exp.merchant || exp.id.slice(0, 8)}`,
        periodFrom: receiptDay.format('YYYY-MM-DD'),
        periodTo: receiptDay.format('YYYY-MM-DD'),
        expenseIds: [exp.id],
        autoClose: true,
      });
      setSingleExpenseToLiquidate(null);
      setSelectedIds((prev) => prev.filter((id) => id !== exp.id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al liquidar gasto');
    } finally {
      setSavingSingle(false);
    }
  };

  // Crear lote con seleccionados
  const handleOpenBatchDialog = () => {
    if (selectedIds.length === 0) return;
    setBatchName(`Lote de liquidación ${dayjs().format('DD/MM/YYYY')}`);
    setBatchFrom(dayjs().startOf('month'));
    setBatchTo(dayjs());
    setBatchDialogOpen(true);
  };

  const handleCreateBatch = async () => {
    if (!batchFrom || !batchTo || selectedIds.length === 0) return;
    setSavingBatch(true);
    setError(null);
    try {
      await api.post('/settlements', {
        name: batchName.trim() || undefined,
        periodFrom: batchFrom.format('YYYY-MM-DD'),
        periodTo: batchTo.format('YYYY-MM-DD'),
        expenseIds: selectedIds.map(String),
      });
      setBatchDialogOpen(false);
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear lote');
    } finally {
      setSavingBatch(false);
    }
  };

  const handleCloseBatch = async (id: string) => {
    if (!window.confirm('¿Cerrar lote y marcar gastos como pagados / liquidados?')) return;
    setError(null);
    try {
      await api.post(`/settlements/${id}/close`, {});
      await load();
      setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cerrar lote');
    }
  };

  const handleOpenDetail = async (id: string) => {
    try {
      const data = await api.get<SettlementBatchDetail>(`/settlements/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al abrir lote');
    }
  };

  const handleExportXlsx = async (id: string) => {
    await api.download(`/settlements/${id}/export.xlsx`, `liquidacion-${id}.xlsx`);
  };

  // Totales acumulados de items seleccionados
  const selectedTotals = useMemo(() => {
    const selectedExpenses = approved.filter((e) => selectedIds.includes(e.id));
    const totals: Record<string, number> = {};
    for (const e of selectedExpenses) {
      const curr = e.currency || 'ARS';
      totals[curr] = (totals[curr] || 0) + e.amount;
    }
    return Object.entries(totals)
      .map(([c, n]) => formatMoney(n, c))
      .join(', ');
  }, [approved, selectedIds]);

  // Columnas base compartidas de comprobantes
  const baseExpenseColumns: GridColDef<Expense>[] = [
    {
      field: 'folio',
      headerName: 'ID',
      width: 110,
      valueGetter: (_v, row) => row.folio ?? '—',
    },
    {
      field: 'receiptDate',
      headerName: 'Fecha',
      width: 110,
      valueGetter: (_v, row) => formatDate(row.receiptDate ?? row.submittedAt),
    },
    {
      field: 'amount',
      headerName: 'Monto',
      width: 130,
      valueGetter: (_v, row) => formatMoney(row.amount, row.currency),
    },
    { field: 'merchant', headerName: 'Comercio', minWidth: 140, flex: 1 },
    {
      field: 'description',
      headerName: 'Motivo',
      minWidth: 150,
      flex: 1,
      valueGetter: (_v, row) => row.description || '—',
    },
    {
      field: 'clientId',
      headerName: 'Cliente',
      minWidth: 130,
      flex: 1,
      valueGetter: (_v, row) => lookup.clientMap[row.clientId] ?? row.clientId,
    },
    {
      field: 'kind',
      headerName: 'Tipo',
      width: 100,
      valueGetter: (_v, row) => (row.kind ? CLIENT_KIND_LABELS[row.kind] : '—'),
    },
    {
      field: 'projectId',
      headerName: 'Proyecto',
      minWidth: 130,
      flex: 1,
      valueGetter: (_v, row) => (row.projectId ? lookup.projectMap[row.projectId] ?? row.projectId : '—'),
    },
    {
      field: 'glpiTicketNumber',
      headerName: 'GLPI',
      width: 90,
      valueGetter: (_v, row) =>
        row.glpiTicketNumber != null ? `#${row.glpiTicketNumber}` : row.glpiTicketId != null ? `#${row.glpiTicketId}` : '—',
    },
    {
      field: 'technicianId',
      headerName: 'Empleado',
      minWidth: 140,
      flex: 1,
      valueGetter: (_v, row) => lookup.techMap[row.technicianId] ?? row.technicianId,
    },
    {
      field: 'locationId',
      headerName: 'Ubicación',
      minWidth: 120,
      flex: 1,
      valueGetter: (_v, row) => (row.locationId ? lookup.locationMap[row.locationId] ?? row.locationId : '—'),
    },
  ];

  // Columnas de la tabla de gastos pendientes de liquidar (con liquidación individual)
  const pendingColumns: GridColDef<Expense>[] = [
    ...baseExpenseColumns,
    {
      field: 'actions',
      headerName: 'Acciones',
      width: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ height: '100%' }}>
          <Tooltip title="Ver comprobante">
            <IconButton size="small" color="primary" onClick={() => void handleViewPhoto(row)}>
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Descargar comprobante">
            <IconButton size="small" color="info" onClick={() => void handleDownloadReceipt(row)}>
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Liquidar individualmente">
            <Button
              size="small"
              variant="outlined"
              color="success"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={() => setSingleExpenseToLiquidate(row)}
              sx={{ py: 0.2, px: 1, fontSize: '0.75rem', textTransform: 'none' }}
            >
              Liquidar
            </Button>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  // Columnas para el detalle del lote (ver y descargar comprobante)
  const detailExpenseColumns: GridColDef<Expense>[] = [
    ...baseExpenseColumns,
    {
      field: 'actions',
      headerName: 'Acciones',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ height: '100%' }}>
          <Tooltip title="Ver comprobante">
            <IconButton size="small" color="primary" onClick={() => void handleViewPhoto(row)}>
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Descargar comprobante">
            <IconButton size="small" color="info" onClick={() => void handleDownloadReceipt(row)}>
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  // Columnas de la tabla de lotes
  const batchColumns: GridColDef<SettlementBatch>[] = [
    {
      field: 'name',
      headerName: 'Nombre del lote',
      flex: 1,
      valueGetter: (_v, row) => row.name || `Lote ${row.id.slice(0, 8)}`,
    },
    {
      field: 'period',
      headerName: 'Período',
      width: 200,
      valueGetter: (_v, row) => `${row.periodFrom} → ${row.periodTo}`,
    },
    {
      field: 'status',
      headerName: 'Estado',
      width: 120,
      valueGetter: (_v, row) => (row.status === 'CLOSED' ? 'Liquidado' : 'Borrador'),
    },
    {
      field: 'count',
      headerName: 'Comprobantes',
      width: 120,
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
      width: 240,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ height: '100%' }}>
          <Button size="small" onClick={() => void handleOpenDetail(row.id)}>
            Ver
          </Button>
          {row.status === 'DRAFT' && (
            <Button size="small" color="success" onClick={() => void handleCloseBatch(row.id)}>
              Cerrar
            </Button>
          )}
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => void handleExportXlsx(row.id)}
          >
            Excel
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
      <Box sx={{ pb: 6 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Liquidación de Viáticos
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* SECCIÓN SUPERIOR: Gastos pendientes de liquidar */}
        <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', sm: 'center' }}
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="h6">Comprobantes pendientes de liquidar</Typography>
                <Typography variant="body2" color="text.secondary">
                  Comprobantes aprobados listos para ser liquidados individualmente o agrupados en lote.
                </Typography>
              </Box>

              <Stack direction="row" spacing={2} alignItems="center">
                {selectedIds.length > 0 && (
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'primary.main' }}>
                    {selectedIds.length} seleccionados ({selectedTotals})
                  </Typography>
                )}
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={selectedIds.length === 0}
                  onClick={handleOpenBatchDialog}
                >
                  Generar lote ({selectedIds.length})
                </Button>
              </Stack>
            </Stack>

            <DataGrid
              rows={approved}
              columns={pendingColumns}
              loading={loading}
              checkboxSelection
              rowSelectionModel={selectedIds}
              onRowSelectionModelChange={setSelectedIds}
              autoHeight
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              sx={{ bgcolor: 'background.paper' }}
            />
          </CardContent>
        </Card>

        {/* SECCIÓN INFERIOR: Historial de lotes */}
        <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Historial de lotes de liquidación
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Lotes generados para seguimiento, cierre contable y exportación a Excel.
            </Typography>

            <DataGrid
              rows={batches}
              columns={batchColumns}
              loading={loading}
              autoHeight
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              sx={{ bgcolor: 'background.paper' }}
            />
          </CardContent>
        </Card>

        {/* DETALLE DE LOTE SELECCIONADO */}
        {detail && (
          <Box sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">
                Detalle del lote {detail.name || detail.id.slice(0, 8)} — {statusLabels[detail.status] ?? detail.status}
              </Typography>
              <Button onClick={() => setDetail(null)}>Cerrar detalle</Button>
            </Stack>
            <DataGrid
              rows={detail.expenses ?? []}
              columns={detailExpenseColumns}
              autoHeight
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              sx={{ bgcolor: 'background.paper' }}
            />
          </Box>
        )}

        {/* MODAL: GENERAR LOTE CON SELECCIONADOS */}
        <Dialog open={batchDialogOpen} onClose={() => setBatchDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Generar lote de liquidación</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Se agruparán {selectedIds.length} comprobante(s) por un total de {selectedTotals}.
            </Typography>
            <TextField
              fullWidth
              label="Nombre del lote (opcional)"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              sx={{ mb: 2, mt: 1 }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DatePicker
                label="Período desde"
                value={batchFrom}
                onChange={setBatchFrom}
                slotProps={{ textField: { fullWidth: true } }}
              />
              <DatePicker
                label="Período hasta"
                value={batchTo}
                onChange={setBatchTo}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBatchDialogOpen(false)} disabled={savingBatch}>
              Cancelar
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleCreateBatch()}
              disabled={savingBatch || !batchFrom || !batchTo}
            >
              {savingBatch ? 'Generando…' : 'Crear lote'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* MODAL: CONFIRMAR LIQUIDACIÓN INDIVIDUAL */}
        <Dialog
          open={singleExpenseToLiquidate != null}
          onClose={() => setSingleExpenseToLiquidate(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Confirmar liquidación individual</DialogTitle>
          <DialogContent>
            {singleExpenseToLiquidate && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                <Typography variant="body1">
                  ¿Deseás liquidar y marcar como pagado este comprobante directamente?
                </Typography>
                <Divider />
                <Typography variant="body2">
                  <strong>Comercio:</strong> {singleExpenseToLiquidate.merchant || '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Monto:</strong>{' '}
                  {formatMoney(singleExpenseToLiquidate.amount, singleExpenseToLiquidate.currency)}
                </Typography>
                <Typography variant="body2">
                  <strong>Fecha:</strong>{' '}
                  {formatDate(singleExpenseToLiquidate.receiptDate ?? singleExpenseToLiquidate.submittedAt)}
                </Typography>
                <Typography variant="body2">
                  <strong>Empleado:</strong>{' '}
                  {lookup.techMap[singleExpenseToLiquidate.technicianId] ?? singleExpenseToLiquidate.technicianId}
                </Typography>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSingleExpenseToLiquidate(null)} disabled={savingSingle}>
              Cancelar
            </Button>
            <Button
              variant="contained"
              color="success"
              onClick={() => void handleConfirmSingleLiquidate()}
              disabled={savingSingle}
            >
              {savingSingle ? 'Liquidando…' : 'Confirmar liquidación'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* MODAL: VISOR DE FOTO / COMPROBANTE (BOTÓN OJO) */}
        <Dialog
          open={photoDialogOpen}
          onClose={() => setPhotoDialogOpen(false)}
          maxWidth={false}
          fullWidth
          PaperProps={{
            sx: {
              m: { xs: 1, sm: 2 },
              width: 'calc(100% - 16px)',
              maxWidth: '96vw',
              height: '96vh',
              bgcolor: 'grey.900',
              color: 'common.white',
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1,
              borderBottom: '1px solid',
              borderColor: 'grey.800',
            }}
          >
            <Typography variant="subtitle1">{photoTitle}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Tooltip title="Alejar">
                <span>
                  <IconButton
                    color="inherit"
                    size="small"
                    disabled={photoZoom <= 1}
                    onClick={() => setPhotoZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
                  >
                    <ZoomOutIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'center' }}>
                {Math.round(photoZoom * 100)}%
              </Typography>
              <Tooltip title="Acercar">
                <span>
                  <IconButton
                    color="inherit"
                    size="small"
                    disabled={photoZoom >= 4}
                    onClick={() => setPhotoZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
                  >
                    <ZoomInIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                color="inherit"
                size="small"
                onClick={() => setPhotoDialogOpen(false)}
                aria-label="Cerrar"
              >
                <CloseIcon />
              </IconButton>
            </Stack>
          </Box>

          <Box
            sx={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              alignItems: photoZoom === 1 ? 'center' : 'flex-start',
              justifyContent: photoZoom === 1 ? 'center' : 'flex-start',
              p: 2,
              height: 'calc(96vh - 56px)',
            }}
          >
            {photoLoading ? (
              <CircularProgress sx={{ color: 'common.white' }} />
            ) : photoUrl ? (
              photoUrl.toLowerCase().includes('.pdf') ? (
                <Box
                  component="iframe"
                  src={photoUrl}
                  title="Comprobante PDF"
                  sx={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    bgcolor: 'background.paper',
                    borderRadius: 1,
                  }}
                />
              ) : (
                <Box
                  component="img"
                  src={photoUrl}
                  alt="Comprobante"
                  onClick={() => setPhotoZoom((z) => (z >= 3 ? 1 : Number((z + 0.5).toFixed(1))))}
                  sx={{
                    maxWidth: photoZoom === 1 ? '100%' : 'none',
                    maxHeight: photoZoom === 1 ? '100%' : 'none',
                    width: photoZoom === 1 ? 'auto' : `${photoZoom * 100}%`,
                    height: 'auto',
                    cursor: photoZoom >= 3 ? 'zoom-out' : 'zoom-in',
                    userSelect: 'none',
                    display: 'block',
                  }}
                />
              )
            ) : (
              <Typography variant="body1" color="grey.400">
                No hay comprobante disponible.
              </Typography>
            )}
          </Box>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}
