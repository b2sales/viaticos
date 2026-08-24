import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/useApi';
import type {
  ApprovalChain,
  ApprovalChainStep,
  ListResponse,
  Role,
  RoleCapabilities,
} from '../types';

const CAP_LABELS: { key: keyof RoleCapabilities; label: string }[] = [
  { key: 'canApprove', label: 'Aprobar gastos' },
  { key: 'canLiquidate', label: 'Liquidar' },
  { key: 'canManageMasters', label: 'Clientes / proyectos' },
  { key: 'canManageTeam', label: 'Gestionar equipo' },
  { key: 'canConfigureRoles', label: 'Configurar roles' },
];

const emptyCaps = (): RoleCapabilities => ({
  canApprove: false,
  canLiquidate: false,
  canManageMasters: false,
  canManageTeam: false,
  canConfigureRoles: false,
});

export function RolesPage() {
  const api = useApi();
  const [roles, setRoles] = useState<Role[]>([]);
  const [chains, setChains] = useState<ApprovalChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleDialog, setRoleDialog] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [caps, setCaps] = useState<RoleCapabilities>(emptyCaps());
  const [saving, setSaving] = useState(false);

  const [chainSubmitter, setChainSubmitter] = useState('');
  const [chainSteps, setChainSteps] = useState<string[]>([]);
  const [savingChain, setSavingChain] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, c] = await Promise.all([
        api.get<ListResponse<Role>>('/roles'),
        api.get<ListResponse<ApprovalChain>>('/approval-chains'),
      ]);
      setRoles(r.items);
      setChains(c.items);
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
    setEditing(null);
    setName('');
    setActive(true);
    setCaps(emptyCaps());
    setRoleDialog(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setName(role.name);
    setActive(role.active);
    setCaps({ ...role.capabilities });
    setRoleDialog(true);
  };

  const saveRole = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { name, active, capabilities: caps };
      if (editing) {
        await api.patch(`/roles/${editing.id}`, body);
      } else {
        await api.post('/roles', body);
      }
      setRoleDialog(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const loadChainEditor = (submitterRoleId: string) => {
    setChainSubmitter(submitterRoleId);
    const existing = chains.find((c) => c.submitterRoleId === submitterRoleId);
    setChainSteps(
      existing?.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => s.approverRoleId) ?? [''],
    );
  };

  const saveChain = async () => {
    if (!chainSubmitter) return;
    setSavingChain(true);
    setError(null);
    try {
      const steps: ApprovalChainStep[] = chainSteps
        .filter(Boolean)
        .map((approverRoleId, order) => ({ order, approverRoleId }));
      await api.put('/approval-chains', {
        submitterRoleId: chainSubmitter,
        steps,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar cadena');
    } finally {
      setSavingChain(false);
    }
  };

  const roleName = (id: string) =>
    roles.find((r) => r.id === id)?.name ?? id;

  const columns: GridColDef<Role>[] = [
    { field: 'name', headerName: 'Nombre', flex: 1, minWidth: 140 },
    {
      field: 'capabilities',
      headerName: 'Permisos',
      flex: 2,
      minWidth: 220,
      valueGetter: (_v, row) =>
        CAP_LABELS.filter((c) => row.capabilities[c.key])
          .map((c) => c.label)
          .join(', ') || '—',
    },
    { field: 'active', headerName: 'Activo', width: 90, type: 'boolean' },
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

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">Roles / perfiles</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Nuevo rol
        </Button>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <DataGrid
        rows={roles}
        columns={columns}
        loading={loading}
        autoHeight
        pageSizeOptions={[10, 25]}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        sx={{ bgcolor: 'background.paper', mb: 4 }}
      />

      <Typography variant="h6" sx={{ mb: 1 }}>
        Cadenas de aprobación
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Definí qué rol(es) aprueban los gastos de cada rol remitente (en orden).
      </Typography>

      <Stack spacing={2} sx={{ maxWidth: 560, mb: 2 }}>
        <FormControl fullWidth>
          <InputLabel id="chain-submitter">Rol que informa el gasto</InputLabel>
          <Select
            labelId="chain-submitter"
            label="Rol que informa el gasto"
            value={chainSubmitter}
            onChange={(e) => loadChainEditor(e.target.value)}
          >
            {roles.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {chainSubmitter &&
          chainSteps.map((stepRole, idx) => (
            <FormControl fullWidth key={idx}>
              <InputLabel id={`step-${idx}`}>Paso {idx + 1} — aprueba</InputLabel>
              <Select
                labelId={`step-${idx}`}
                label={`Paso ${idx + 1} — aprueba`}
                value={stepRole}
                onChange={(e) => {
                  const next = [...chainSteps];
                  next[idx] = e.target.value;
                  setChainSteps(next);
                }}
              >
                {roles.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ))}

        {chainSubmitter && (
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => setChainSteps((s) => [...s, ''])}
              disabled={chainSteps.length >= 5}
            >
              + Paso
            </Button>
            <Button
              onClick={() =>
                setChainSteps((s) => (s.length > 1 ? s.slice(0, -1) : s))
              }
              disabled={chainSteps.length <= 1}
            >
              − Paso
            </Button>
            <Button
              variant="contained"
              onClick={() => void saveChain()}
              disabled={savingChain || chainSteps.every((s) => !s)}
            >
              Guardar cadena
            </Button>
          </Stack>
        )}
      </Stack>

      <Box sx={{ mt: 2 }}>
        {chains.map((c) => (
          <Typography key={c.submitterRoleId} variant="body2" sx={{ mb: 0.5 }}>
            <strong>{roleName(c.submitterRoleId)}</strong>
            {' → '}
            {c.steps
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((s) => roleName(s.approverRoleId))
              .join(' → ')}
          </Typography>
        ))}
      </Box>

      <Dialog
        open={roleDialog}
        onClose={() => setRoleDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editing ? 'Editar rol' : 'Nuevo rol'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <FormGroup sx={{ mb: 2 }}>
            {CAP_LABELS.map((c) => (
              <FormControlLabel
                key={c.key}
                control={
                  <Checkbox
                    checked={caps[c.key]}
                    onChange={(e) =>
                      setCaps((prev) => ({
                        ...prev,
                        [c.key]: e.target.checked,
                      }))
                    }
                  />
                }
                label={c.label}
              />
            ))}
          </FormGroup>
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
          <Button onClick={() => setRoleDialog(false)}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={() => void saveRole()}
            disabled={!name.trim() || saving}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
