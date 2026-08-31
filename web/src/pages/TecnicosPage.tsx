import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMsal } from '@azure/msal-react';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { fetchSupervisorsFromGraph } from '../auth/graphSupervisors';
import { useAuthMe } from '../auth/AuthMeContext';
import type { Employee, EntraSupervisor, ListResponse } from '../types';

function telegramStatus(row: Employee): 'linked' | 'pending' | 'none' {
  if (row.telegramUserId) return 'linked';
  if (row.telegramLinkCode) return 'pending';
  return 'none';
}

export function TecnicosPage() {
  const api = useApi();
  const { instance } = useMsal();
  const { capabilities } = useAuthMe();
  const isAdmin = capabilities.canConfigureRoles;
  const [items, setItems] = useState<Employee[]>([]);
  const [supervisors, setSupervisors] = useState<EntraSupervisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [managerEntraOid, setManagerEntraOid] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [supervisorsError, setSupervisorsError] = useState<string | null>(null);

  const supervisorMap = useMemo(() => {
    const map: Record<string, EntraSupervisor> = {};
    for (const s of supervisors) {
      map[s.oid.toLowerCase()] = s;
    }
    return map;
  }, [supervisors]);

  const loadSupervisors = useCallback(async () => {
    if (!capabilities.canConfigureRoles && !capabilities.canManageTeam) return;
    setSupervisorsError(null);
    try {
      const items = await fetchSupervisorsFromGraph(instance);
      setSupervisors(items);
    } catch (err) {
      console.error('Supervisores Graph', err);
      setSupervisors([]);
      setSupervisorsError(
        err instanceof Error
          ? err.message
          : 'No se pudieron cargar supervisores desde Microsoft Entra',
      );
    }
  }, [instance, capabilities.canConfigureRoles, capabilities.canManageTeam]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const empRes = await api.get<ListResponse<Employee>>('/technicians');
      setItems(empRes.items);
      await loadSupervisors();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api, loadSupervisors]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLinkCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setEmail('');
    setTelegramUserId('');
    setTelegramLinkCode(null);
    setManagerEntraOid(supervisors[0]?.oid ?? '');
    setActive(true);
    setDialogOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setName(emp.name);
    setEmail(emp.email ?? '');
    setTelegramUserId(emp.telegramUserId ?? '');
    setTelegramLinkCode(emp.telegramLinkCode ?? null);
    setManagerEntraOid(emp.managerEntraOid ?? '');
    setActive(emp.active);
    setDialogOpen(true);
  };

  const regenerateLinkCode = async () => {
    if (!editing) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await api.post<{ telegramLinkCode: string }>(
        `/technicians/${editing.id}/regenerate-link-code`,
        {},
      );
      setTelegramLinkCode(res.telegramLinkCode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al regenerar código');
    } finally {
      setRegenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Partial<Employee> = {
        name,
        email: email || undefined,
        active,
      };
      if (isAdmin) {
        body.managerEntraOid = managerEntraOid || undefined;
        body.telegramUserId = telegramUserId || undefined;
      }
      if (editing) {
        await api.patch(`/technicians/${editing.id}`, body);
      } else {
        await api.post('/technicians', body);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const columns: GridColDef<Employee>[] = [
    { field: 'name', headerName: 'Nombre', flex: 1, minWidth: 160 },
    {
      field: 'managerEntraOid',
      headerName: 'Supervisor',
      flex: 1,
      minWidth: 160,
      valueGetter: (_v, row) => {
        const sup = row.managerEntraOid
          ? supervisorMap[row.managerEntraOid.toLowerCase()]
          : undefined;
        return sup?.name ?? row.managerEntraOid ?? '—';
      },
    },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 160 },
    {
      field: 'telegramStatus',
      headerName: 'Telegram',
      width: 110,
      sortable: false,
      valueGetter: (_v, row) => telegramStatus(row),
      renderCell: ({ row }) => {
        const status = telegramStatus(row);
        if (status === 'linked') {
          return <Chip label="Vinculado" size="small" color="success" />;
        }
        if (status === 'pending') {
          return <Chip label="Pendiente" size="small" color="warning" />;
        }
        return <Chip label="—" size="small" variant="outlined" />;
      },
    },
    {
      field: 'telegramLinkCode',
      headerName: 'Palabra clave',
      width: 140,
      sortable: false,
      renderCell: ({ row }) =>
        row.telegramLinkCode ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" fontFamily="monospace">
              {row.telegramLinkCode}
            </Typography>
            <Tooltip title="Copiar">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyLinkCode(row.telegramLinkCode!);
                }}
              >
                <ContentCopyIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          '—'
        ),
    },
    {
      field: 'active',
      headerName: 'Activo',
      width: 90,
      type: 'boolean',
    },
    {
      field: 'actions',
      headerName: '',
      width: 60,
      sortable: false,
      renderCell: ({ row }) => (
        <IconButton size="small" onClick={() => openEdit(row)}>
          <EditIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  const isLinked = Boolean(editing?.telegramUserId || telegramUserId);
  const pendingLinkCode = !isLinked && (telegramLinkCode ?? editing?.telegramLinkCode);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">
          {isAdmin ? 'Usuarios' : 'Mi equipo'}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Nuevo
        </Button>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {supervisorsError && isAdmin && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {supervisorsError}
        </Alert>
      )}
      <DataGrid
        rows={items}
        columns={columns}
        loading={loading}
        autoHeight
        pageSizeOptions={[10, 25]}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        sx={{ bgcolor: 'background.paper' }}
      />

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editing ? 'Editar usuario' : 'Nuevo usuario'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          {isAdmin && (
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel id="supervisor-label">Supervisor</InputLabel>
              <Select
                labelId="supervisor-label"
                label="Supervisor"
                value={managerEntraOid}
                onChange={(e) => setManagerEntraOid(e.target.value)}
                renderValue={(value) => {
                  const sup = supervisorMap[value.toLowerCase()];
                  if (sup) {
                    return sup.email ? `${sup.name} (${sup.email})` : sup.name;
                  }
                  return value;
                }}
              >
                {supervisors.map((s) => (
                  <MenuItem key={s.oid} value={s.oid}>
                    {s.name}
                    {s.email ? ` (${s.email})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <TextField
            fullWidth
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            helperText="Opcional — referencia interna del usuario"
            sx={{ mb: 2 }}
          />

          {isLinked ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              Telegram vinculado
              {isAdmin && telegramUserId ? ` (ID ${telegramUserId})` : ''}
            </Alert>
          ) : pendingLinkCode ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Palabra clave para el bot
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h6" fontFamily="monospace">
                  {pendingLinkCode}
                </Typography>
                <Tooltip title="Copiar">
                  <IconButton
                    size="small"
                    onClick={() => void copyLinkCode(pendingLinkCode)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {editing && (
                  <Button
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={() => void regenerateLinkCode()}
                    disabled={regenerating}
                  >
                    Regenerar
                  </Button>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Comunicale esta palabra al usuario para que escriba al bot por
                primera vez.
              </Typography>
            </Box>
          ) : editing && !isLinked ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Este usuario aún no tiene palabra clave para vincular Telegram.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => void regenerateLinkCode()}
                disabled={regenerating}
              >
                Generar palabra clave
              </Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Al guardar se generará una palabra clave para vincular Telegram.
            </Typography>
          )}

          {isAdmin && !isLinked && (
            <TextField
              fullWidth
              label="Telegram User ID (override admin)"
              value={telegramUserId}
              onChange={(e) => setTelegramUserId(e.target.value)}
              helperText="Opcional: vincular manualmente sin palabra clave."
              sx={{ mb: 2 }}
            />
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
            }
            label="Activo"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={
              !name.trim() ||
              saving ||
              (isAdmin && !managerEntraOid && !editing)
            }
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
