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

export const statusColors: Record<string, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  PENDING: 'warning',
  NEEDS_INFO: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  IN_LIQUIDATION: 'info',
  PAID: 'success',
};

export const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  NEEDS_INFO: 'Info requerida',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  IN_LIQUIDATION: 'En liquidación',
  PAID: 'Pagado',
};
