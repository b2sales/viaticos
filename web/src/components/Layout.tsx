import InboxIcon from '@mui/icons-material/Inbox';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BusinessIcon from '@mui/icons-material/Business';
import CategoryIcon from '@mui/icons-material/Category';
import PlaceIcon from '@mui/icons-material/Place';
import FolderIcon from '@mui/icons-material/Folder';
import EngineeringIcon from '@mui/icons-material/Engineering';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PaymentsIcon from '@mui/icons-material/Payments';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMsal } from '@azure/msal-react';
import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuthMe } from '../auth/AuthMeContext';

const DRAWER_WIDTH = 240;

export function Layout() {
  const { instance, accounts } = useMsal();
  const { capabilities, me } = useAuthMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const account = accounts[0];

  const navItems = useMemo(() => {
    const items: { to: string; label: string; icon: React.ReactNode }[] = [];
    if (capabilities.canApprove) {
      items.push({ to: '/', label: 'Bandeja', icon: <InboxIcon /> });
    }
    if (
      capabilities.canApprove ||
      capabilities.canLiquidate ||
      capabilities.canConfigureRoles
    ) {
      items.push({
        to: '/consolidados',
        label: 'Consolidados',
        icon: <AssessmentIcon />,
      });
    }
    if (capabilities.canManageMasters) {
      items.push({ to: '/clientes', label: 'Clientes', icon: <BusinessIcon /> });
      items.push({
        to: '/proyectos',
        label: 'Proyectos',
        icon: <FolderIcon />,
      });
      items.push({
        to: '/motivos',
        label: 'Motivos',
        icon: <CategoryIcon />,
      });
      items.push({
        to: '/ubicaciones',
        label: 'Ubicaciones',
        icon: <PlaceIcon />,
      });
    }
    if (capabilities.canManageTeam || capabilities.canConfigureRoles) {
      items.push({
        to: '/empleados',
        label: 'Empleados',
        icon: <EngineeringIcon />,
      });
    }
    if (capabilities.canConfigureRoles) {
      items.push({
        to: '/roles',
        label: 'Roles',
        icon: <AdminPanelSettingsIcon />,
      });
    }
    if (capabilities.canLiquidate) {
      items.push({
        to: '/liquidacion',
        label: 'Liquidación',
        icon: <PaymentsIcon />,
      });
    }
    return items;
  }, [capabilities]);

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar>
        <Typography variant="h6" noWrap color="primary">
          Viáticos
        </Typography>
      </Toolbar>
      <Divider />
      <List sx={{ flex: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            sx={{
              '&.active': {
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '& .MuiListItemIcon-root': { color: 'inherit' },
              },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      {me?.role?.name && (
        <Box sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Rol: {me.role.name}
            {me.isBootstrapAdmin ? ' (admin Entra)' : ''}
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}
        color="default"
        elevation={1}
      >
        <Toolbar>
          <IconButton
            edge="start"
            sx={{ mr: 2, display: { sm: 'none' } }}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Panel — Ecorp
          </Typography>
          <Typography
            variant="body2"
            sx={{ mr: 2, display: { xs: 'none', md: 'block' } }}
          >
            {account?.name ?? account?.username}
          </Typography>
          <IconButton
            aria-label="Cerrar sesión"
            onClick={() => instance.logoutRedirect()}
          >
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: 8,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
