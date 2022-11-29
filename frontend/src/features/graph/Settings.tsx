import MenuIcon from '@mui/icons-material/Menu';
import { Divider, FormControlLabel, Menu, MenuItem, MenuList, Paper, Switch, TextField } from '@mui/material';
import Button from '@mui/material/Button';
import { KeyboardEvent, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../../app/store';
import { MAX_POSSIBLE_VISIBLE_NODES, MIN_POSSIBLE_VISIBLE_NODES } from './global/tuning';
import { ASetMaxNodes, GraphState, staticState } from './graph-reducer';
import { RenderedNode } from './rendering';

export type FocusCam = (node: RenderedNode) => void
export type ZoomToFit = (delay: number) => void

export function Settings(props: {
  unfreezeAll: () => void,
  zoomToFit: ZoomToFit,
  focusCam: FocusCam,
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>,
  state: GraphState
}) {
  const state = props.state
  const dispatch = props.dispatch

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [maxNodesTxt, setMaxNodesTxt] = useState(`${state.settings.maxNodes}`)
  const open = Boolean(anchorEl);

  return useMemo(() => {

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    const focusSelected = () => {
      if (state.selectedNode) {
        const rNode = staticState.peekRenderedNode(state.selectedNode)
        if (rNode && !state.settings.autoFocus && state.selectedNode.length > 0) {
          props.focusCam(rNode)
          return true
        }
      }
      return false
    }

    const focusMain = () => {
      if (!focusSelected()) {
        props.zoomToFit(500)
      }
    }

    const handleChainModeToggle = () => {
      if (state.settings.viewMode !== 'chain') {
        props.unfreezeAll()
        dispatch({ type: 'SetViewMode', viewMode: 'chain' })
      }
      focusMain()
    }

    const handleGraphModeToggle = () => {
      if (state.settings.viewMode !== 'graph') {
        props.unfreezeAll()
        dispatch({ type: 'SetViewMode', viewMode: 'graph' })
      }
      focusMain()
    }

    const handleAutoFocusToggle = () => {
      dispatch({ type: 'SetAutoFocus', autoFocus: !state.settings.autoFocus })
      if (!state.settings.autoFocus) {
        focusMain()
      }
    }

    const handleVrToggle = () => {
      dispatch({ type: 'SetVrEnabled', vrEnabled: !state.settings.vrEnabled })
      focusSelected()
    }

    const handleSetMaxNodes = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.code === 'Enter') {
        const parsed = parseInt(maxNodesTxt)
        if (Number.isFinite(parsed)) {
          const validatedMax = Math.max(
            MIN_POSSIBLE_VISIBLE_NODES,
            Math.min(parsed, MAX_POSSIBLE_VISIBLE_NODES))
          setMaxNodesTxt(`${validatedMax}`)
          const setMaxAction: ASetMaxNodes = { type: 'SetMaxNodes', maxNodes: validatedMax }
          dispatch(setMaxAction)
        }
      }
    }

    return <div id="settings">
      <Button
        id="basic-button"
        aria-controls={open ? 'basic-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleClick}
        size="large"
      >
        <MenuIcon fontSize="medium" />
      </Button>
      <Menu
        id="basic-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'basic-button',
        }}
      >
        <Paper sx={{ width: 320, maxWidth: '100%' }}>
          <MenuList>
            <MenuItem>
              <FormControlLabel color="primary" control={<Switch onClick={handleChainModeToggle} checked={state.settings.viewMode === 'chain'} />} label="View as Chain" />
            </MenuItem>
            <MenuItem>
              <FormControlLabel color="secondary" control={<Switch onClick={handleGraphModeToggle} checked={state.settings.viewMode === 'graph'} />} label="View as Clusters" />
            </MenuItem>
            <Divider />
            <MenuItem>
              <FormControlLabel color="secondary" control={<Switch onClick={handleAutoFocusToggle} checked={state.settings.autoFocus} />} label="Auto-Focus Selections" />
            </MenuItem>
            {/*<MenuItem>
              <FormControlLabel color="secondary" control={<Switch onClick={handleVrToggle} checked={state.settings.vrEnabled} />} label="Enable VR" />
            </MenuItem>*/}
            <Divider />
            <MenuItem>
              <TextField label={`Max Nodes to Show (${staticState.nodeCount()} / ${props.state.settings.maxNodes})`}
                sx={{ m: 1, width: '25ch' }}
                onInput={(e) => {
                  //@ts-ignore
                  setMaxNodesTxt(e.target.value as string)
                }} inputProps={{ inputMode: 'numeric', pattern: '[0-9][0-9]+' }} value={maxNodesTxt} onKeyUp={handleSetMaxNodes} />
            </MenuItem>
          </MenuList>
        </Paper>
      </Menu>
    </div>
  }, [state.settings, state.nodeDataHash, open, maxNodesTxt])
}
