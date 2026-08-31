import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0277bd',
      dark: '#01579b',
      light: '#58a5f0',
    },
    secondary: {
      main: '#00897b',
      dark: '#00695c',
      light: '#4ebaaa',
    },
    background: {
      default: '#f4f7fa',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
});

export const statusColors: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error' | 'secondary'> = {
  PENDING: 'warning',
  NEEDS_INFO: 'info',
  APPROVED: 'warning',
  REJECTED: 'error',
  IN_LIQUIDATION: 'secondary',
  PAID: 'success',
};

export interface StatusChipStyle {
  bgcolor: string;
  color: string;
  borderColor: string;
  fontWeight?: number;
}

export const statusChipStyles: Record<string, StatusChipStyle> = {
  PENDING: {
    bgcolor: '#fff7ed', // naranja suave
    color: '#c2410c', // texto naranja oscuro
    borderColor: '#fed7aa',
    fontWeight: 600,
  },
  NEEDS_INFO: {
    bgcolor: '#f0f9ff', // celeste suave
    color: '#0369a1', // texto celeste/azul
    borderColor: '#bae6fd',
    fontWeight: 600,
  },
  APPROVED: {
    bgcolor: '#fef08a', // amarillo nítido (yellow-200)
    color: '#713f12', // texto amarillo/dorado oscuro (yellow-900)
    borderColor: '#eab308', // borde amarillo fuerte
    fontWeight: 600,
  },
  IN_LIQUIDATION: {
    bgcolor: '#faf5ff', // púrpura suave
    color: '#6b21a8', // texto violeta
    borderColor: '#e9d5ff',
    fontWeight: 600,
  },
  PAID: {
    bgcolor: '#f0fdf4', // verde suave
    color: '#15803d', // texto verde
    borderColor: '#86efac',
    fontWeight: 600,
  },
  REJECTED: {
    bgcolor: '#fef2f2', // rojo suave
    color: '#b91c1c', // texto rojo
    borderColor: '#fca5a5',
    fontWeight: 600,
  },
};

export const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  NEEDS_INFO: 'Info requerida',
  APPROVED: 'Pendiente liquidación',
  REJECTED: 'Rechazado',
  IN_LIQUIDATION: 'En liquidación',
  PAID: 'Liquidado',
};
