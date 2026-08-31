import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
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
  ClientKind,
  ExpenseStatus,
  ListResponse,
  Project,
  SummaryReport,
} from '../types';
import { CLIENT_KIND_LABELS, formatMoney } from '../types';

export function ConsolidadosPage() {
  const api = useApi();
  const [from, setFrom] = useState<Dayjs | null>(dayjs().startOf('month'));
  const [to, setTo] = useState<Dayjs | null>(dayjs());
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState<'' | ClientKind>('');
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [report, setReport] = useState<SummaryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, p] = await Promise.all([
        api.get<ListResponse<Client>>('/clients'),
        api.get<ListResponse<Project>>('/projects'),
      ]);
      setClients(c.items);
      setProjects(p.items);
    })();
  }, [api]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.format('YYYY-MM-DD'));
    if (to) params.set('to', to.format('YYYY-MM-DD'));
    if (clientId) params.set('clientId', clientId);
    if (projectId) params.set('projectId', projectId);
    if (kind) params.set('kind', kind);
    return params.toString();
  }, [from, to, clientId, projectId, kind]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SummaryReport>(
        `/reports/summary?${queryString}`,
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [api, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  );
  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const exportXlsx = async () => {
    await api.download(
      `/reports/export.xlsx?${queryString}`,
      `viaticos-${dayjs().format('YYYY-MM-DD')}.xlsx`,
    );
  };

  const statuses: ExpenseStatus[] = [
    'PENDING',
    'NEEDS_INFO',
    'APPROVED',
    'REJECTED',
  ];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
      <Box>
        <Typography variant="h5" gutterBottom>
          Consolidados
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <DatePicker
            label="Desde"
            value={from}
            onChange={setFrom}
            slotProps={{ textField: { size: 'small' } }}
          />
          <DatePicker
            label="Hasta"
            value={to}
            onChange={setTo}
            slotProps={{ textField: { size: 'small' } }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Cliente</InputLabel>
            <Select
              label="Cliente"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId('');
              }}
            >
              <MenuItem value="">Todos</MenuItem>
              {clients.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Proyecto</InputLabel>
            <Select
              label="Proyecto"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <MenuItem value="">Todos</MenuItem>
              {projects
                .filter((p) => !clientId || p.clientId === clientId)
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Tipo</InputLabel>
            <Select
              label="Tipo"
              value={kind}
              onChange={(e) => setKind(e.target.value as '' | ClientKind)}
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="PROYECTO">Proyecto</MenuItem>
              <MenuItem value="SERVICIO">Servicio</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => void exportXlsx()}
            sx={{ alignSelf: { md: 'center' } }}
          >
            Exportar Excel
          </Button>
        </Stack>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          {statuses.map((status) => (
            <Grid item xs={12} sm={6} md={3} key={status}>
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {statusLabels[status]}
                  </Typography>
                  <Typography variant="h5">
                    {loading ? '…' : (report?.byStatus[status]?.count ?? 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatMoney(report?.byStatus[status]?.total ?? 0)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" gutterBottom>
          Por tipo
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {(['PROYECTO', 'SERVICIO'] as ClientKind[]).map((k) => (
            <Grid item xs={12} sm={6} md={4} key={k}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1">
                    {CLIENT_KIND_LABELS[k]}
                  </Typography>
                  <Typography variant="body2">
                    {loading
                      ? '…'
                      : `${report?.byKind?.[k]?.count ?? 0} gastos · ${formatMoney(report?.byKind?.[k]?.total ?? 0)}`}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" gutterBottom>
          Por cliente
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {Object.entries(report?.byClient ?? {}).map(([id, data]) => (
            <Grid item xs={12} sm={6} md={4} key={id}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1">
                    {clientMap[id] ?? id}
                  </Typography>
                  <Typography variant="body2">
                    {data.count} gastos · {formatMoney(data.total)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" gutterBottom>
          Por proyecto
        </Typography>
        <Grid container spacing={2}>
          {Object.entries(report?.byProject ?? {}).map(([id, data]) => (
            <Grid item xs={12} sm={6} md={4} key={id}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1">
                    {projectMap[id] ?? id}
                  </Typography>
                  <Typography variant="body2">
                    {data.count} gastos · {formatMoney(data.total)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    </LocalizationProvider>
  );
}
