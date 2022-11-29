import { Link, Typography } from '@mui/material';
import { GlobalStateProps } from '../../App';
import logoSrc from '../../assets/dg-logo.png';
import GraphWrap from './Graph';

function Copyright() {
  return (
    <Typography variant="body2" color="text.secondary" align="center">
      {'Copyright © '}
      <Link color="inherit" href="https://decentralgraph.com/">
        Decentral Graph
      </Link>{' '}
      {new Date().getFullYear()}
      {'.'}
    </Typography>
  );
}

export function GraphPage(props: GlobalStateProps) {
  return <div id="graph" style={{ width: "100%", height: "100%", position: "absolute", top: "0", left: "0", overflow: 'hidden' }}>
    <div className='header-logo'>
      <img src={logoSrc} alt='decentralgraph' />
    </div>
    <GraphWrap key="graphWrap" globalState={props.globalState} />
    <Copyright />
  </div>
}
