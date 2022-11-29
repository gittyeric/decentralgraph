import AssignmentIcon from '@mui/icons-material/Assignment';
import BarChartIcon from '@mui/icons-material/BarChart';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import MuiLink from '@mui/material/Link';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import * as React from 'react';
import { Link } from 'react-router-dom';

export const mainListItems = (
  <React.Fragment>
    <ListItemButton>
      <MuiLink component={Link} to='/'>
        <ListItemIcon style={{ float: 'left' }}>
          <DashboardIcon />
        </ListItemIcon>
        <ListItemText>Home</ListItemText>
      </MuiLink>
    </ListItemButton>
    <ListItemButton>
      <MuiLink component={Link} to='/search'>
        <ListItemIcon style={{ float: 'left' }}>
          <ShoppingCartIcon />
        </ListItemIcon>
        <ListItemText>Search</ListItemText>
      </MuiLink>
    </ListItemButton>
    <ListItemButton>
      <MuiLink component={Link} to='/contracts'>
        <ListItemIcon style={{ float: 'left' }}>
          <PeopleIcon />
        </ListItemIcon>
        <ListItemText>Contracts</ListItemText>
      </MuiLink>
    </ListItemButton>
    <ListItemButton>
      <MuiLink component={Link} to='/whales'>
        <ListItemIcon style={{ float: 'left' }}>
          <BarChartIcon />
        </ListItemIcon>
        <ListItemText>Whales</ListItemText>
      </MuiLink>
    </ListItemButton>
  </React.Fragment>
);

export const secondaryListItems = (
  <React.Fragment>
    <ListSubheader component="div" inset>
      Recent History
    </ListSubheader>
    <ListItemButton>
      <ListItemIcon>
        <AssignmentIcon />
      </ListItemIcon>
      <ListItemText primary="Current month" />
    </ListItemButton>
    <ListItemButton>
      <ListItemIcon>
        <AssignmentIcon />
      </ListItemIcon>
      <ListItemText primary="Last quarter" />
    </ListItemButton>
    <ListItemButton>
      <ListItemIcon>
        <AssignmentIcon />
      </ListItemIcon>
      <ListItemText primary="Year-end sale" />
    </ListItemButton>
  </React.Fragment>
);
