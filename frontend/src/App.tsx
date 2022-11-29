import { createTheme, ThemeProvider } from '@mui/material';
import React from 'react';
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import './App.css';
import { isErr } from './features/graph/global/fetch-contract';
import { GlobalState, isGraphNode } from './features/graph/global/types';
import { remoteFetcher } from './features/graph/graph-fetchers';
import { GraphPage } from './features/graph/GraphPage';
const { useState } = React;

export type GlobalStateProps = {
  globalState: GlobalState
}

const mdTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ffffff', // Text color
      dark: '#ffffff'
    },
    error: {
      main: '#f44336',
    },
    secondary: {
      main: '#f50057',
      dark: '#aaaaaa'
    },
    background: {
      default: '#000000',
      paper: '#333333'
    }
  },
});

export default function App() {
  const [globalState, setGlobalState] = useState({} as GlobalState);
  const [serverPushGen] = useState(remoteFetcher.requestServerPush());

  serverPushGen.next().then((obj) => {
    //if (!obj.done) {
      if (obj.value !== undefined && !isErr(obj.value) && !isGraphNode(obj.value)) {
        setGlobalState({eth: obj.value});
      } else if (obj.value) {
        //throw new Error('Non-chain state not supported!?');
      }
    //}
  });

  const graphPage = <GraphPage key="graphPage" globalState={globalState} />
  return (
    <Router>
      <ThemeProvider theme={mdTheme}>
        <Routes>
          <Route path="*" element={graphPage} />
        </Routes>
      </ThemeProvider>
    </Router>
  );
}
