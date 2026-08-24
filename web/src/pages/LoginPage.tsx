import MicrosoftIcon from '@mui/icons-material/Microsoft';
import {
  Box,
  Button,
  Container,
  Paper,
  Typography,
} from '@mui/material';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth/msalConfig';

export function LoginPage() {
  const { instance } = useMsal();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Container maxWidth="sm">
        <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h4" gutterBottom color="primary">
            Viáticos
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 4 }}>
            Panel de administración — Ecorp
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<MicrosoftIcon />}
            onClick={() => instance.loginRedirect(loginRequest)}
          >
            Iniciar sesión con Microsoft
          </Button>
        </Paper>
      </Container>
    </Box>
  );
}
