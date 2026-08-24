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
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { useAuthMe } from '../auth/AuthMeContext';
import type { Employee, ListResponse, Role } from '../types';

function telegramStatus(row: Employee): 'linked' | 'pending' | 'none' {
  if (row.telegramUserId) return 'linked';
  if (row.telegramLinkCode) return 'pending';
  return 'none';
}

export function EmpleadosPage() {
  const api = useApi();
  const { capabilities, me } = useAuthMe();
  const isAdmin = capabilities.canConfigureRoles;
  const [items, setItems] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [entraOid, setEntraOid] = useState('');
  const [roleId, setRoleId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const roleMap = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r.name])),
    [roles],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, rolesRes] = await Promise.all([
        api.get<ListResponse<Employee>>('/technicians'),
        api.get<ListResponse<Role>>('/roles'),
      ]);
      setItems(empRes.items);
      setRoles(rolesRes.items.filter((r) => r.active));
      if (isAdmin) {
        setAllEmployees(empRes.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin]);

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
    setEntraOid('');
    setRoleId(roles[0]?.id ?? '');
    setManagerId(isAdmin ? '' : me?.employee?.id ?? '');
    setActive(true);
    setDialogOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setName(emp.name);
    setEmail(emp.email ?? '');
    setTelegramUserId(emp.telegramUserId ?? '');
    setTelegramLinkCode(emp.telegramLinkCode ?? null);
    setEntraOid(emp.entraOid ?? '');
    setRoleId(emp.roleId);
    setManagerId(emp.managerId ?? '');
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
        entraOid: entraOid || undefined,
        roleId,
        active,
      };
      if (isAdmin) {
        body.managerId = managerId || undefined;
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
      field: 'roleId',
      headerName: 'Rol',
      width: 140,
      valueGetter: (_v, row) => roleMap[row.roleId] ?? row.roleId,
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
          {isAdmin ? 'Empleados' : 'Mi equipo'}
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
          {editing ? 'Editar empleado' : 'Nuevo empleado'}
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
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="role-label">Rol</InputLabel>
            <Select
              labelId="role-label"
              label="Rol"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {isAdmin && (
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel id="manager-label">Jefe directo</InputLabel>
              <Select
                labelId="manager-label"
                label="Jefe directo"
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
              >
                <MenuItem value="">— Ninguno —</MenuItem>
                {allEmployees
                  .filter((e) => e.id !== editing?.id)
                  .map((e) => (
                    <MenuItem key={e.id} value={e.id}>
                      {e.name}
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
                Comunicale esta palabra al empleado para que escriba al bot por
                primera vez.
              </Typography>
            </Box>
          ) : editing && !isLinked ? (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Este empleado aún no tiene palabra clave para vincular Telegram.
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

          {isAdmin && (
            <TextField
              fullWidth
              label="Entra OID (login web)"
              value={entraOid}
              onChange={(e) => setEntraOid(e.target.value)}
              helperText="Object ID de Azure AD para acceso al panel"
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
            disabled={!name.trim() || !roleId || saving}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
