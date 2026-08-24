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
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/useApi';
import type { Client, ClientKind, ListResponse } from '../types';

const KIND_LABELS: Record<ClientKind, string> = {
  PROYECTO: 'Proyecto',
  SERVICIO: 'Servicio',
};

export function ClientesPage() {
  const api = useApi();
  const [items, setItems] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<ClientKind>('PROYECTO');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<Client>>('/clients');
      setItems(res.items);
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
    setCode('');
    setKind('PROYECTO');
    setActive(true);
    setDialogOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditing(client);
    setName(client.name);
    setCode(client.code ?? '');
    setKind(client.kind ?? 'PROYECTO');
    setActive(client.active);
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { name, code: code || undefined, kind, active };
      if (editing) {
        await api.patch(`/clients/${editing.id}`, body);
      } else {
        await api.post('/clients', body);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const columns: GridColDef<Client>[] = [
    { field: 'name', headerName: 'Nombre', flex: 1, minWidth: 160 },
    { field: 'code', headerName: 'Código', width: 120 },
    {
      field: 'kind',
      headerName: 'Tipo',
      width: 120,
      valueGetter: (_v, row) => KIND_LABELS[row.kind ?? 'PROYECTO'],
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

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">Clientes</Typography>
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Código"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="client-kind-label">Tipo</InputLabel>
            <Select
              labelId="client-kind-label"
              value={kind}
              label="Tipo"
              onChange={(e) => setKind(e.target.value as ClientKind)}
            >
              <MenuItem value="PROYECTO">Proyecto</MenuItem>
              <MenuItem value="SERVICIO">Servicio</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
            }
            label="Activo"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={() => void save()} disabled={!name.trim() || saving}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
