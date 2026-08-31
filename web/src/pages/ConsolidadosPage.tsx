import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import TableChartIcon from '@mui/icons-material/TableChart';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
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
  Location,
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
  const [locationId, setLocationId] = useState('');
  const [kind, setKind] = useState<'' | ClientKind>('');
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [report, setReport] = useState<SummaryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAllLocations, setShowAllLocations] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  useEffect(() => {
    void (async () => {
      const [c, p, l] = await Promise.all([
        api.get<ListResponse<Client>>('/clients'),
        api.get<ListResponse<Project>>('/projects'),
        api.get<ListResponse<Location>>('/locations'),
      ]);
      setClients(c.items);
      setProjects(p.items);
      setLocations(l.items);
    })();
  }, [api]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.format('YYYY-MM-DD'));
    if (to) params.set('to', to.format('YYYY-MM-DD'));
    if (clientId) params.set('clientId', clientId);
    if (projectId) params.set('projectId', projectId);
    if (locationId) params.set('locationId', locationId);
    if (kind) params.set('kind', kind);
    return params.toString();
  }, [from, to, clientId, projectId, locationId, kind]);

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
  const locationMap = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  const locationEntries = useMemo(() => {
    if (!report?.byLocation) return [];
    return Object.entries(report.byLocation)
      .map(([id, data]) => ({
        id,
        name: id === '__none__' ? 'Sin ubicación' : (locationMap[id] ?? id),
        count: data.count,
        total: data.total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [report?.byLocation, locationMap]);

  const totalLocationExpense = useMemo(
    () => locationEntries.reduce((acc, curr) => acc + curr.total, 0),
    [locationEntries],
  );

  const top5Locations = useMemo(
    () => locationEntries.slice(0, 5),
    [locationEntries],
  );

  const filteredLocationsTable = useMemo(() => {
    const q = locationSearch.toLowerCase().trim();
    if (!q) return locationEntries;
    return locationEntries.filter((item) =>
      item.name.toLowerCase().includes(q),
    );
  }, [locationEntries, locationSearch]);

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

        <Stack
          direction="row"
          flexWrap="wrap"
          gap={2}
          sx={{ mb: 3 }}
          alignItems="center"
        >
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
          <FormControl size="small" sx={{ minWidth: 160 }}>
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
          <FormControl size="small" sx={{ minWidth: 160 }}>
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
            <InputLabel>Ubicación</InputLabel>
            <Select
              label="Ubicación"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <MenuItem value="">Todas</MenuItem>
              {locations.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
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
        <Grid container spacing={2} sx={{ mb: 3 }}>
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

        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1, mt: 2 }}
        >
          <Typography variant="h6">
            Por ubicación {top5Locations.length > 0 && '(Top 5 por gasto)'}
          </Typography>
          {locationEntries.length > 0 && (
            <Button
              size="small"
              variant="text"
              startIcon={<TableChartIcon />}
              onClick={() => setShowAllLocations((prev) => !prev)}
            >
              {showAllLocations
                ? 'Ocultar tabla completa'
                : `Ver todas las ubicaciones (${locationEntries.length})`}
            </Button>
          )}
        </Stack>

        {loading ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Cargando datos por ubicación…
          </Typography>
        ) : top5Locations.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            No hay gastos registrados por ubicación en el período seleccionado.
          </Typography>
        ) : (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {top5Locations.map((item, idx) => (
              <Grid item xs={12} sm={6} md={4} key={item.id}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography
                      variant="overline"
                      color="primary.main"
                      sx={{ fontWeight: 600 }}
                    >
                      #{idx + 1} en gastos
                    </Typography>
                    <Typography variant="subtitle1" noWrap title={item.name}>
                      {item.name}
                    </Typography>
                    <Typography variant="body2">
                      {item.count} gastos · {formatMoney(item.total)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {showAllLocations && (
          <Box sx={{ mb: 4, mt: 1 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', sm: 'center' }}
              spacing={2}
              sx={{ mb: 2 }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Todas las ubicaciones ({locationEntries.length})
              </Typography>
              <TextField
                size="small"
                placeholder="Filtrar por ubicación…"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                sx={{ maxWidth: { sm: 300 } }}
              />
            </Stack>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Ubicación</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Comprobantes
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      Monto total
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      % del total
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredLocationsTable.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        align="center"
                        sx={{ py: 3, color: 'text.secondary' }}
                      >
                        No se encontraron ubicaciones que coincidan con la
                        búsqueda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLocationsTable.map((item, index) => {
                      const percentage =
                        totalLocationExpense > 0
                          ? ((item.total / totalLocationExpense) * 100).toFixed(
                              1,
                            )
                          : '0.0';
                      return (
                        <TableRow key={item.id} hover>
                          <TableCell sx={{ color: 'text.secondary', width: 50 }}>
                            {index + 1}
                          </TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>
                            {item.name}
                          </TableCell>
                          <TableCell align="right">{item.count}</TableCell>
                          <TableCell align="right">
                            {formatMoney(item.total)}
                          </TableCell>
                          <TableCell align="right">
                            {percentage}%
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  );
}
