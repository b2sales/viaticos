import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/es';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { useAuthMe } from '../auth/AuthMeContext';
import { statusChipStyles, statusLabels } from '../theme';
import type {
  Client,
  ClientKind,
  ExpenseDetail,
  ExpenseMotive,
  ExpenseUpdateBody,
  GlpiTicket,
  GlpiTicketsResponse,
  ListResponse,
  Location,
  Project,
} from '../types';
import { CLIENT_KIND_LABELS, formatDate, formatDateTime, formatMoney } from '../types';

interface ExpenseDetailDialogProps {
  expenseId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  readOnly?: boolean;
  clientName?: string;
  projectName?: string;
  technicianName?: string;
  locationName?: string;
}

export function ExpenseDetailDialog({
  expenseId,
  open,
  onClose,
  onUpdated,
  readOnly = false,
  clientName,
  projectName,
  technicianName,
  locationName,
}: ExpenseDetailDialogProps) {
  const api = useApi();
  const { capabilities } = useAuthMe();
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedKind, setSelectedKind] = useState<ClientKind | ''>('');
  const [ticketOptions, setTicketOptions] = useState<GlpiTicket[]>([]);
  const [ticketQuery, setTicketQuery] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<GlpiTicket | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [glpiUiBase, setGlpiUiBase] = useState<string | undefined>();
  const [glpiError, setGlpiError] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [motives, setMotives] = useState<ExpenseMotive[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState('ARS');
  const [editMerchant, setEditMerchant] = useState('');
  const [editReceiptDate, setEditReceiptDate] = useState<Dayjs | null>(null);
  const [editMotiveId, setEditMotiveId] = useState('');
  const [editLocationId, setEditLocationId] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editGlpiTicket, setEditGlpiTicket] = useState('');
  const [editClearGlpi, setEditClearGlpi] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  const syncEditForm = useCallback((data: ExpenseDetail) => {
    setEditAmount(String(data.amount));
    setEditCurrency(data.currency || 'ARS');
    setEditMerchant(data.merchant ?? '');
    setEditReceiptDate(data.receiptDate ? dayjs(data.receiptDate) : null);
    setEditMotiveId(data.motiveId ?? '');
    setEditLocationId(data.locationId ?? '');
    setEditClientId(data.clientId);
    setEditGlpiTicket(
      data.glpiTicketNumber != null
        ? String(data.glpiTicketNumber)
        : data.glpiTicketId != null
          ? String(data.glpiTicketId)
          : '',
    );
    setEditClearGlpi(false);
  }, []);

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ExpenseDetail>(`/expenses/${expenseId}`);
      setExpense(data);
      setSelectedProjectId(data.projectId ?? '');
      setSelectedKind(data.kind ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api, expenseId]);

  const canAct =
    !readOnly &&
    (expense?.status === 'PENDING' || expense?.status === 'NEEDS_INFO');

  const canDelete = capabilities.canConfigureRoles && expense != null;

  useEffect(() => {
    if (open && expenseId) void load();
    if (!open) {
      setExpense(null);
      setAskText('');
      setAskOpen(false);
      setRejectText('');
      setRejectOpen(false);
      setDeleteOpen(false);
      setLightboxOpen(false);
      setLightboxZoom(1);
      setSelectedProjectId('');
      setSelectedKind('');
      setSelectedTicket(null);
      setTicketQuery('');
      setTicketOptions([]);
      setProjects([]);
      setGlpiError(null);
      setEditMode(false);
      setClients([]);
      setMotives([]);
      setLocations([]);
    }
  }, [open, expenseId, load]);

  useEffect(() => {
    if (!open || !canAct) return;
    let cancelled = false;
    void (async () => {
      try {
        const [clientsRes, motivesRes, locationsRes] = await Promise.all([
          api.get<ListResponse<Client>>('/clients'),
          api.get<ListResponse<ExpenseMotive>>('/motives'),
          api.get<ListResponse<Location>>('/locations'),
        ]);
        if (!cancelled) {
          setClients(clientsRes.items.filter((c) => c.active));
          setMotives(motivesRes.items.filter((m) => m.active));
          setLocations(locationsRes.items.filter((l) => l.active));
        }
      } catch {
        if (!cancelled) {
          setClients([]);
          setMotives([]);
          setLocations([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, open, canAct]);

  useEffect(() => {
    if (!open || !expense?.clientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<ListResponse<Project>>(
          `/projects?clientId=${encodeURIComponent(expense.clientId)}`,
        );
        if (!cancelled) {
          setProjects(res.items.filter((p) => p.active));
        }
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, open, expense?.clientId]);

  useEffect(() => {
    if (!open || !expense) return;
    if (expense.glpiTicketId == null || glpiUiBase) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<GlpiTicketsResponse>('/glpi/tickets');
        if (!cancelled && res.uiBase) setGlpiUiBase(res.uiBase);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, open, expense, glpiUiBase]);

  useEffect(() => {
    if (!open) return;
    const actionable =
      expense?.status === 'PENDING' || expense?.status === 'NEEDS_INFO';
    if (!actionable) return;

    const handle = window.setTimeout(() => {
      void (async () => {
        setTicketsLoading(true);
        setGlpiError(null);
        try {
          const q = ticketQuery.trim();
          const path = q
            ? `/glpi/tickets?q=${encodeURIComponent(q)}`
            : '/glpi/tickets';
          const res = await api.get<GlpiTicketsResponse>(path);
          setTicketOptions(res.items);
          if (res.uiBase) setGlpiUiBase(res.uiBase);
        } catch (err) {
          setTicketOptions([]);
          setGlpiError(
            err instanceof Error ? err.message : 'Error al buscar tickets GLPI',
          );
        } finally {
          setTicketsLoading(false);
        }
      })();
    }, 300);

    return () => window.clearTimeout(handle);
  }, [api, open, expense?.status, ticketQuery]);

  const hasLinkedGlpi = expense?.glpiTicketId != null;

  const isFinalApproval = expense?.approvalMeta?.isFinalApproval !== false;

  const projectLabel = useMemo(() => {
    if (expense?.projectId) {
      const found = projects.find((p) => p.id === expense.projectId);
      return found?.name ?? projectName ?? expense.projectId;
    }
    return projectName ?? '—';
  }, [expense?.projectId, projects, projectName]);

  const displayClientName = useMemo(() => {
    if (clientName) return clientName;
    const found = clients.find((c) => c.id === expense?.clientId);
    return found?.name ?? expense?.clientId ?? '—';
  }, [clientName, clients, expense?.clientId]);

  const displayLocationLabel = useMemo(() => {
    if (locationName) return locationName;
    const found = locations.find((l) => l.id === expense?.locationId);
    return found?.name ?? (expense?.locationId ? expense.locationId : '—');
  }, [locationName, locations, expense?.locationId]);

  const handleStartEdit = () => {
    if (!expense) return;
    syncEditForm(expense);
    setEditMode(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    if (expense) syncEditForm(expense);
    setEditMode(false);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!expenseId || !expense) return;
    setSaveLoading(true);
    setError(null);
    try {
      const body: ExpenseUpdateBody = {
        amount: Number(editAmount),
        currency: editCurrency.trim() || 'ARS',
        merchant: editMerchant.trim(),
        receiptDate: editReceiptDate?.format('YYYY-MM-DD') ?? '',
        motiveId: editMotiveId,
        locationId: editLocationId,
        clientId: editClientId,
      };

      const originalGlpi =
        expense.glpiTicketNumber != null
          ? String(expense.glpiTicketNumber)
          : expense.glpiTicketId != null
            ? String(expense.glpiTicketId)
            : '';

      if (editClearGlpi) {
        body.glpiTicketId = null;
      } else if (editGlpiTicket.trim() !== originalGlpi) {
        if (editGlpiTicket.trim()) {
          body.glpiTicketId = Number(editGlpiTicket.trim());
        }
      }

      const updated = await api.patch<ExpenseDetail>(
        `/expenses/${expenseId}`,
        body,
      );
      setExpense(updated);
      setSelectedProjectId(updated.projectId ?? '');
      setSelectedKind(updated.kind ?? '');
      setEditMode(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaveLoading(false);
    }
  };

  const runAction = async (action: 'approve' | 'reject' | 'ask') => {
    if (!expenseId) return;
    setActionLoading(true);
    setError(null);
    try {
      if (action === 'ask') {
        await api.post(`/expenses/${expenseId}/ask`, { text: askText });
        setAskOpen(false);
        setAskText('');
      } else if (action === 'approve') {
        if (!selectedKind) {
          setError('Seleccioná Proyecto o Servicio antes de aprobar');
          setActionLoading(false);
          return;
        }
        const body: {
          kind: ClientKind;
          projectId?: string;
          ticketId?: number;
        } = { kind: selectedKind };
        if (selectedProjectId) {
          body.projectId = selectedProjectId;
        }
        if (isFinalApproval && selectedTicket && !hasLinkedGlpi) {
          body.ticketId = selectedTicket.id;
        }
        await api.post(`/expenses/${expenseId}/approve`, body);
      } else if (action === 'reject') {
        await api.post(`/expenses/${expenseId}/reject`, {
          text: rejectText.trim() || undefined,
        });
        setRejectOpen(false);
        setRejectText('');
      }
      await load();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en la acción');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!expenseId) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.delete(`/expenses/${expenseId}`);
      setDeleteOpen(false);
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setActionLoading(false);
    }
  };

  const isPdf = Boolean(
    expense?.receiptS3Key?.toLowerCase().endsWith('.pdf') ||
    expense?.receiptUrl?.toLowerCase().includes('.pdf'),
  );

  const glpiTicketUrl =
    expense?.glpiTicketId != null && glpiUiBase
      ? `${glpiUiBase}/front/ticket.form.php?id=${expense.glpiTicketId}`
      : expense?.glpiTicketId != null
        ? undefined
        : undefined;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          Detalle del gasto
          {expense?.folio ? ` · ${expense.folio}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {expense && !loading && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={statusLabels[expense.status] ?? expense.status}
                  variant="outlined"
                  sx={{
                    bgcolor: statusChipStyles[expense.status]?.bgcolor,
                    color: statusChipStyles[expense.status]?.color,
                    borderColor: statusChipStyles[expense.status]?.borderColor,
                    fontWeight: statusChipStyles[expense.status]?.fontWeight ?? 600,
                  }}
                />
                {!editMode && (
                  <Typography variant="h5">
                    {formatMoney(expense.amount, expense.currency)}
                  </Typography>
                )}
              </Stack>

              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="subtitle1">Datos del gasto</Typography>
                {canAct && !editMode && (
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={handleStartEdit}
                  >
                    Editar datos
                  </Button>
                )}
              </Stack>

              {editMode ? (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
                >
                  <Field label="ID" value={expense.folio ?? '—'} />
                  <TextField
                    label="Monto"
                    type="number"
                    size="small"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    inputProps={{ min: 0, step: '0.01' }}
                  />
                  <TextField
                    label="Moneda"
                    size="small"
                    value={editCurrency}
                    onChange={(e) => setEditCurrency(e.target.value)}
                  />
                  <TextField
                    label="Comercio"
                    size="small"
                    value={editMerchant}
                    onChange={(e) => setEditMerchant(e.target.value)}
                  />
                  <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
                    <DatePicker
                      label="Fecha del ticket"
                      value={editReceiptDate}
                      onChange={setEditReceiptDate}
                      format="DD/MM/YYYY"
                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                    />
                  </LocalizationProvider>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-motive-label">Motivo</InputLabel>
                    <Select
                      labelId="edit-motive-label"
                      label="Motivo"
                      value={editMotiveId}
                      onChange={(e) => setEditMotiveId(e.target.value)}
                    >
                      {motives.map((m) => (
                        <MenuItem key={m.id} value={m.id}>
                          {m.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-location-label">Ubicación</InputLabel>
                    <Select
                      labelId="edit-location-label"
                      label="Ubicación"
                      value={editLocationId}
                      onChange={(e) => setEditLocationId(e.target.value)}
                    >
                      {locations.map((l) => (
                        <MenuItem key={l.id} value={l.id}>
                          {l.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" sx={{ gridColumn: { sm: '1 / -1' } }}>
                    <InputLabel id="edit-client-label">Cliente</InputLabel>
                    <Select
                      labelId="edit-client-label"
                      label="Cliente"
                      value={editClientId}
                      onChange={(e) => setEditClientId(e.target.value)}
                    >
                      {clients.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ sm: 'flex-start' }}
                    sx={{ gridColumn: { sm: '1 / -1' } }}
                  >
                    <TextField
                      label="Incidente GLPI (número)"
                      size="small"
                      type="number"
                      value={editGlpiTicket}
                      onChange={(e) => {
                        setEditGlpiTicket(e.target.value);
                        setEditClearGlpi(false);
                      }}
                      placeholder="Opcional"
                      sx={{ flex: 1 }}
                    />
                    {(expense.glpiTicketId != null || editGlpiTicket.trim()) && (
                      <Button
                        size="small"
                        color="warning"
                        onClick={() => {
                          setEditGlpiTicket('');
                          setEditClearGlpi(true);
                        }}
                        sx={{ mt: { xs: 0, sm: 0.5 } }}
                      >
                        Quitar incidente
                      </Button>
                    )}
                  </Stack>
                  {(expense.glpiTicketId != null || editGlpiTicket.trim()) &&
                    !editClearGlpi &&
                    expense.glpiTicketTitle && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ gridColumn: { sm: '1 / -1' } }}
                      >
                        Actual: #{expense.glpiTicketNumber ?? expense.glpiTicketId}
                        {expense.glpiTicketTitle
                          ? ` — ${expense.glpiTicketTitle}`
                          : ''}
                      </Typography>
                    )}
                  <Field
                    label="Enviado"
                    value={formatDateTime(expense.submittedAt)}
                  />
                  <Field
                    label="Tipo"
                    value={
                      expense.kind
                        ? CLIENT_KIND_LABELS[expense.kind]
                        : '—'
                    }
                  />
                  <Field label="Proyecto" value={projectLabel} />
                  <Field
                    label="Técnico"
                    value={technicianName ?? expense.technicianId}
                  />
                </Box>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
                >
                  <Field label="ID" value={expense.folio ?? '—'} />
                  <Field label="Comercio" value={expense.merchant ?? '—'} />
                  <Field
                    label="Fecha del ticket"
                    value={formatDate(expense.receiptDate)}
                  />
                  <Field
                    label="Enviado"
                    value={formatDateTime(expense.submittedAt)}
                  />
                  <Field label="Cliente" value={displayClientName} />
                  <Field
                    label="Tipo"
                    value={
                      expense.kind
                        ? CLIENT_KIND_LABELS[expense.kind]
                        : '—'
                    }
                  />
                  <Field label="Proyecto" value={projectLabel} />
                  <Field
                    label="Técnico"
                    value={technicianName ?? expense.technicianId}
                  />
                  <Field label="Motivo" value={expense.description ?? '—'} />
                  <Field label="Ubicación" value={displayLocationLabel} />
                </Box>
              )}

              {!editMode && expense.glpiTicketId != null && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Ticket GLPI
                  </Typography>
                  <Typography variant="body1">
                    #{expense.glpiTicketNumber ?? expense.glpiTicketId}
                    {expense.glpiTicketTitle
                      ? ` — ${expense.glpiTicketTitle}`
                      : ''}
                    {glpiTicketUrl && (
                      <>
                        {' '}
                        <Link
                          href={glpiTicketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                        >
                          Abrir
                          <OpenInNewIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />
                        </Link>
                      </>
                    )}
                  </Typography>
                </Box>
              )}

              {canAct && !editMode && (
                <Stack spacing={2}>
                  <Divider />
                  <Typography variant="subtitle1">Aprobación</Typography>
                  {expense.approvalMeta && (
                    <Typography variant="body2" color="text.secondary">
                      Aprobación paso{' '}
                      {(expense.approvalMeta.step ?? 0) + 1} de{' '}
                      {expense.approvalMeta.totalSteps}
                      {expense.approvalMeta.isFinalApproval
                        ? ' (final)'
                        : ' (intermedio)'}
                    </Typography>
                  )}
                  <FormControl required>
                    <FormLabel id="approve-kind-label">Tipo</FormLabel>
                    <RadioGroup
                      row
                      aria-labelledby="approve-kind-label"
                      name="approve-kind"
                      value={selectedKind}
                      onChange={(e) =>
                        setSelectedKind(e.target.value as ClientKind)
                      }
                    >
                      <FormControlLabel
                        value="PROYECTO"
                        control={<Radio size="small" />}
                        label="Proyecto"
                      />
                      <FormControlLabel
                        value="SERVICIO"
                        control={<Radio size="small" />}
                        label="Servicio"
                      />
                    </RadioGroup>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel id="approve-project-label">
                      Proyecto (opcional)
                    </InputLabel>
                    <Select
                      labelId="approve-project-label"
                      label="Proyecto (opcional)"
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                    >
                      <MenuItem value="">— Sin asignar —</MenuItem>
                      {projects.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {isFinalApproval && !hasLinkedGlpi && (
                    <>
                      <Autocomplete
                        options={ticketOptions}
                        loading={ticketsLoading}
                        value={selectedTicket}
                        onChange={(_e, value) => setSelectedTicket(value)}
                        inputValue={ticketQuery}
                        onInputChange={(_e, value, reason) => {
                          if (reason === 'input' || reason === 'clear') {
                            setTicketQuery(value);
                          }
                        }}
                        getOptionLabel={(opt) =>
                          `#${opt.number} — ${opt.title || 'Sin título'}`
                        }
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        filterOptions={(x) => x}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Ticket GLPI (opcional)"
                            placeholder="Buscar por título o número"
                            size="small"
                            InputProps={{
                              ...params.InputProps,
                              endAdornment: (
                                <>
                                  {ticketsLoading ? (
                                    <CircularProgress color="inherit" size={18} />
                                  ) : null}
                                  {params.InputProps.endAdornment}
                                </>
                              ),
                            }}
                          />
                        )}
                      />
                      {glpiError && (
                        <Alert severity="warning" sx={{ mt: 0 }}>
                          No se pudieron cargar tickets GLPI: {glpiError}
                        </Alert>
                      )}
                    </>
                  )}
                </Stack>
              )}

              {expense.receiptUrl && (
                <Box>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="subtitle2">
                      Comprobante {isPdf ? '(PDF)' : ''}
                    </Typography>
                    <Button
                      size="small"
                      startIcon={isPdf ? <PictureAsPdfIcon /> : <OpenInNewIcon />}
                      href={expense.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir en pestaña nueva
                    </Button>
                  </Stack>
                  {isPdf ? (
                    <Box
                      component="iframe"
                      src={expense.receiptUrl}
                      title="Comprobante PDF"
                      sx={{
                        width: '100%',
                        height: 480,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                      }}
                    />
                  ) : (
                    <>
                      <Box
                        component="img"
                        src={expense.receiptUrl}
                        alt="Comprobante"
                        onClick={() => {
                          setLightboxZoom(1);
                          setLightboxOpen(true);
                        }}
                        sx={{
                          maxWidth: '100%',
                          maxHeight: 360,
                          borderRadius: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          cursor: 'zoom-in',
                          display: 'block',
                          '&:hover': { opacity: 0.92 },
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Clic para ampliar
                      </Typography>
                    </>
                  )}
                </Box>
              )}

              <Divider />

              <Typography variant="subtitle1">Mensajes</Typography>
              {(expense.messages ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Sin mensajes
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {(expense.messages ?? []).map((m) => (
                    <Box
                      key={m.id}
                      sx={{
                        p: 1.5,
                        bgcolor:
                          m.sender === 'admin' ? 'action.hover' : 'grey.100',
                        borderRadius: 1,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {m.sender === 'admin'
                          ? 'Admin'
                          : m.sender === 'technician'
                            ? 'Técnico'
                            : 'Bot'}{' '}
                        · {formatDateTime(m.createdAt)}
                      </Typography>
                      <Typography variant="body2">{m.text}</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {canDelete && !editMode && expense && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteOpen(true)}
              disabled={actionLoading}
              sx={{ mr: 'auto' }}
            >
              Eliminar
            </Button>
          )}
          {editMode && expense && (
            <>
              <Button
                onClick={handleCancelEdit}
                disabled={saveLoading}
              >
                Cancelar
              </Button>
              <Button
                variant="contained"
                onClick={() => void handleSaveEdit()}
                disabled={saveLoading}
              >
                {saveLoading ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </>
          )}
          {canAct && !editMode && expense && (
            <>
              <Button
                startIcon={<QuestionAnswerIcon />}
                onClick={() => setAskOpen(true)}
                disabled={actionLoading}
              >
                Consultar técnico
              </Button>
              <Button
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => setRejectOpen(true)}
                disabled={actionLoading}
              >
                Rechazar
              </Button>
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={() => void runAction('approve')}
                disabled={actionLoading || !selectedKind}
              >
                {isFinalApproval ? 'Aprobar' : 'Aprobar paso'}
              </Button>
            </>
          )}
          {!editMode && (
            <Button onClick={onClose}>Cerrar</Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={askOpen} onClose={() => setAskOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Consultar al técnico</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label="Mensaje"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAskOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={!askText.trim() || actionLoading}
            onClick={() => void runAction('ask')}
          >
            Enviar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rechazar gasto</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Si indicás un motivo, se enviará al técnico por Telegram (opcional).
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label="Motivo del rechazo (opcional)"
            value={rejectText}
            onChange={(e) => setRejectText(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            color="error"
            disabled={actionLoading}
            onClick={() => void runAction('reject')}
          >
            Confirmar rechazo
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Eliminar gasto</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Eliminar el gasto {expense?.folio ?? expense?.id}? Esta acción no se
            puede deshacer. Se borrará el comprobante y se avisará al técnico.
            {expense?.settlementBatchId
              ? ' Si está en un lote de liquidación, se quitará del lote y se recalcularán los totales.'
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            color="error"
            disabled={actionLoading}
            onClick={() => void handleDelete()}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
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
            px: 1.5,
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'grey.800',
          }}
        >
          <Typography variant="subtitle1">Comprobante</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title="Alejar">
              <span>
                <IconButton
                  color="inherit"
                  size="small"
                  disabled={lightboxZoom <= 1}
                  onClick={() =>
                    setLightboxZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))
                  }
                >
                  <ZoomOutIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'center' }}>
              {Math.round(lightboxZoom * 100)}%
            </Typography>
            <Tooltip title="Acercar">
              <span>
                <IconButton
                  color="inherit"
                  size="small"
                  disabled={lightboxZoom >= 4}
                  onClick={() =>
                    setLightboxZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))
                  }
                >
                  <ZoomInIcon />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              color="inherit"
              size="small"
              onClick={() => setLightboxOpen(false)}
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
            alignItems: lightboxZoom === 1 ? 'center' : 'flex-start',
            justifyContent: lightboxZoom === 1 ? 'center' : 'flex-start',
            p: 2,
            height: 'calc(96vh - 48px)',
          }}
        >
          {expense?.receiptUrl && (
            <Box
              component="img"
              src={expense.receiptUrl}
              alt="Comprobante ampliado"
              onClick={() =>
                setLightboxZoom((z) =>
                  z >= 3 ? 1 : Number((z + 0.5).toFixed(1)),
                )
              }
              sx={{
                maxWidth: lightboxZoom === 1 ? '100%' : 'none',
                maxHeight: lightboxZoom === 1 ? '100%' : 'none',
                width: lightboxZoom === 1 ? 'auto' : `${lightboxZoom * 100}%`,
                height: 'auto',
                cursor: lightboxZoom >= 3 ? 'zoom-out' : 'zoom-in',
                userSelect: 'none',
                display: 'block',
              }}
            />
          )}
        </Box>
      </Dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1">{value}</Typography>
    </Box>
  );
}
