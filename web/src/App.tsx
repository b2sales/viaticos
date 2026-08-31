import { InteractionStatus } from '@azure/msal-browser';
import { MsalProvider, useIsAuthenticated, useMsal } from '@azure/msal-react';
import { Box, CircularProgress } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthMeProvider, useAuthMe } from './auth/AuthMeContext';
import { Layout } from './components/Layout';
import { BandejaPage } from './pages/BandejaPage';
import { ClientesPage } from './pages/ClientesPage';
import { ConsolidadosPage } from './pages/ConsolidadosPage';
import { TecnicosPage } from './pages/TecnicosPage';
import { LiquidacionPage } from './pages/LiquidacionPage';
import { LoginPage } from './pages/LoginPage';
import { NoPermissionPage } from './pages/NoPermissionPage';
import { MotivosPage } from './pages/MotivosPage';
import { ProyectosPage } from './pages/ProyectosPage';
import { UbicacionesPage } from './pages/UbicacionesPage';
import { RolesPage } from './pages/RolesPage';
import { theme } from './theme';
import { msalInstance } from './auth/msalConfig';

function AppRoutes() {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const { me, loading, error, capabilities } = useAuthMe();

  if (inProgress !== InteractionStatus.None) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!me || error) {
    return (
      <Routes>
        <Route path="*" element={<NoPermissionPage />} />
      </Routes>
    );
  }

  const defaultPath = capabilities.canApprove
    ? '/'
    : capabilities.canLiquidate
      ? '/liquidacion'
      : capabilities.canManageMasters
        ? '/clientes'
        : capabilities.canManageTeam
          ? '/tecnicos'
          : capabilities.canConfigureRoles
            ? '/roles'
            : '/';

  return (
    <Routes>
      <Route element={<Layout />}>
        {capabilities.canApprove && (
          <Route index element={<BandejaPage />} />
        )}
        {!capabilities.canApprove && (
          <Route index element={<Navigate to={defaultPath} replace />} />
        )}
        {(capabilities.canApprove ||
          capabilities.canLiquidate ||
          capabilities.canConfigureRoles) && (
          <Route path="consolidados" element={<ConsolidadosPage />} />
        )}
        {capabilities.canManageMasters && (
          <>
            <Route path="clientes" element={<ClientesPage />} />
            <Route path="proyectos" element={<ProyectosPage />} />
            <Route path="motivos" element={<MotivosPage />} />
            <Route path="ubicaciones" element={<UbicacionesPage />} />
          </>
        )}
        {(capabilities.canManageTeam || capabilities.canConfigureRoles) && (
          <Route path="tecnicos" element={<TecnicosPage />} />
        )}
        {capabilities.canConfigureRoles && (
          <Route path="roles" element={<RolesPage />} />
        )}
        {capabilities.canLiquidate && (
          <Route path="liquidacion" element={<LiquidacionPage />} />
        )}
        <Route path="empleados" element={<Navigate to="/tecnicos" replace />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Route>
    </Routes>
  );
}

function AuthenticatedApp() {
  return (
    <AuthMeProvider>
      <AppRoutes />
    </AuthMeProvider>
  );
}

export function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthenticatedApp />
        </BrowserRouter>
      </ThemeProvider>
    </MsalProvider>
  );
}
