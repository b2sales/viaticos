import { Box, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';

export function NoPermissionPage() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 2,
      }}
    >
      <LockIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
      <Typography variant="h5">Sin permiso</Typography>
      <Typography variant="body1" color="text.secondary" textAlign="center">
        Tu cuenta no pertenece a ninguno de los grupos de Viáticos en Microsoft
        Entra:
        <br />
        Viaticos-Admins, Viaticos-Supervisores o Viaticos-Liquidacion.
        <br />
        Contactá al equipo de IT si necesitás acceso.
      </Typography>
    </Box>
  );
}
