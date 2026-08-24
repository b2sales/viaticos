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
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/useApi';
import type { ListResponse, Technician } from '../types';

export function TecnicosPage() {
  const api = useApi();
  const [items, setItems] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse<Technician>>('/technicians');
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
    setEmail('');
    setTelegramUserId('');
    setActive(true);
    setDialogOpen(true);
  };

  const openEdit = (tech: Technician) => {
    setEditing(tech);
    setName(tech.name);
    setEmail(tech.email ?? '');
    setTelegramUserId(tech.telegramUserId ?? '');
    setActive(tech.active);
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name,
        email: email || undefined,
        telegramUserId: telegramUserId || undefined,
        active,
      };
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

  const columns: GridColDef<Technician>[] = [
    { field: 'name', headerName: 'Nombre', flex: 1, minWidth: 160 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 180 },
    { field: 'telegramUserId', headerName: 'Telegram ID', width: 140 },
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
        <Typography variant="h5">Técnicos</Typography>
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
        <DialogTitle>{editing ? 'Editar técnico' : 'Nuevo técnico'}</DialogTitle>
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
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Telegram User ID (numérico)"
            value={telegramUserId}
            onChange={(e) => setTelegramUserId(e.target.value)}
            helperText="Solo el ID numérico (ej. 123456789), no el @usuario. El bot lo muestra si el técnico no está habilitado."
            sx={{ mb: 2 }}
          />
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
