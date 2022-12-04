import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/DoneOutline';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import LinkIcon from '@mui/icons-material/Link';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { AppBar, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { Fragment, MouseEvent, MouseEventHandler, MutableRefObject, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { useDispatch } from 'react-redux';
import LoadingGif from '../../../src/assets/loading_blue.gif';
import { AppDispatch } from '../../app/store';
import { isWhale } from './global/biz-types';
import { Address, ADDRESS_TYPE, Block, BLOCK_TYPE, GraphNodes, isAddressId, isBlockId, isFullAddress, isFullBlock, isFullTransaction, isTransaction, isTransactionId, newHexValuedId, newNumberValuedId, parseBlockNumber, parseHexId, Relations, Transaction } from './global/types';
import { assertUnreachable, fromRadix252, makeupName, radix252ToDecimal, radix252ToHex, radix252ToHumanDate, wei252ToBigInt, weiToEth } from './global/utils';
import { AQueried, GraphState, LoadNodeSpec, staticState, TimelineCursor } from './graph-reducer';
import { RenderedNode } from './rendering';
import { Timeline } from './Timeline';

export type FocusCam = (node: RenderedNode) => void

function getDescription(node: GraphNodes): string | undefined {
  const id = node.id
  if (isAddressId(id)) {
    if (isFullAddress(node)) {
      const typeName = isWhale(node) ? "Whale Account" : (node.t === 'c' ? 'Smart Contract' : 'External Owned Account')
      if (node.name) {
        return `Ethereum ${typeName} ${node.name}`
      }
      return `Ethereum ${typeName}`
    }
    return `Address loading...`
  }
  else if (isBlockId(id)) {
    return `Ethereum Block`
  } else if (isTransaction(node)) {
    if (!isFullTransaction(node)) {
      return 'Transaction loading...'
    }
    const fromId = newHexValuedId(node.from, ADDRESS_TYPE)
    if (node.to) {
      const toId = newHexValuedId(node.to, ADDRESS_TYPE)
      return `${makeupName(fromId, true)} sent to ${makeupName(toId, true)}`
    } else {
      return `${makeupName(fromId, true)} created a Contract`
    }
  } else if (isTransactionId(id)) {
    return 'Transaction'
  }
  assertUnreachable(id)
}

function renderNode(
  nodeId: GraphNodes['id'],
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>,
  timelineMark: number,
  timelineRels: Relations[],
  timelineCursors: TimelineCursor[],
  focusCam: FocusCam) {
  const node = staticState.peekGraphNode(nodeId)!
  if (!node) {
    throw new Error('uh oh')
  }
  const id = node.id
  if (isAddressId(id)) {
    return <div key={`add-${id}`}>{AddressPopup(node as Address, timelineMark, timelineRels, timelineCursors, focusCam, dispatch)}</div>
  }
  else if (isBlockId(id)) {
    return <div key={`blo-${id}`}>{BlockPopup(node as Block, focusCam, dispatch)}</div>
  }
  else if (isTransactionId(id)) {
    return TransactionPopup(node as Transaction, dispatch)
  }
  assertUnreachable(id)
}

function LinkedCell(props: {
  text: string,
  onLinkClick?: (e: MouseEvent<HTMLAnchorElement>) => boolean,
  href?: string,
  children?: JSX.Element,
}) {
  const [linkClicked, setLinkClicked] = useState(false)

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    setLinkClicked(true)
    if (props.onLinkClick) {
      return props.onLinkClick(e)
    }

    return false
  }

  return <div className='row-cell'>
    <a className='row-link' style={{ whiteSpace: linkClicked ? 'normal' : 'nowrap' }} href={props.href} onClick={onClick}>{props.text}</a> :
    {props.children}
  </div>
}

const COPY_SUCCESS_DISPLAY_TIME = 2000
function LinkedCopyCell(props: {
  text: string,
  onLinkClick?: (e: MouseEvent<HTMLAnchorElement>) => boolean,
  href?: string,
}) {
  const [lastCopyTime, setCopyTime] = useState(0)
  function copyClicked() {
    navigator.clipboard.writeText(props.text)
    setCopyTime(+new Date())
  }

  const now = +new Date()
  const copied = now - lastCopyTime < COPY_SUCCESS_DISPLAY_TIME
  const child = copied ?
    <IconButton key={`copied-${props.text}`} onClick={copyClicked} color="success" size="small" aria-label='Copy'><CheckIcon /></IconButton> :
    <Button key={`copy-${props.text}`} onClick={copyClicked} variant="outlined" size="small" aria-label='Copy'>Copy</Button>
  const thing = <LinkedCell key={props.text} text={props.text} onLinkClick={props.onLinkClick} href={props.href} children={child}></LinkedCell>
  return thing
}

const loadingRow = <TableRow>
  <TableCell key={`loadingLabel`}><img width="30px" height="30px" src={LoadingGif} alt="loading" /></TableCell>
  <TableCell key={`loadingCell`}><img width="30px" height="30px" src={LoadingGif} alt="loading" /></TableCell>
</TableRow>

function AddressPopup(
  node: Address,
  timelineMark: number,
  timelineRels: Relations[],
  timelineCursors: TimelineCursor[],
  focusCam: FocusCam,
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>) {

  const description = <Typography component="h2" variant="h5" color="primary" gutterBottom>
    {getDescription(node)}
  </Typography>
  const addressUi = <TableRow key="addr">
    <TableCell key={`addr-a`}>Address</TableCell>
    <TableCell key={`addr-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
      <LinkedCopyCell text={parseHexId(node.id)} />
    </TableCell>
  </TableRow>

  return <Fragment key={'addr-' + node.id}>
    {description}
    {timelineCursors.length > 0 ?
      <Timeline dispatch={dispatch} selectedNode={node}
        timelineMark={timelineMark} timelineCursors={timelineCursors}
        timelineRels={timelineRels} />
      : null}
    <Table size="medium"><TableBody>
      {addressUi}
      {isFullAddress(node) ? (
        <Fragment key='loaded'>
          <TableRow key="addrName">
            <TableCell key={`addrName-a`}>{node.name ? 'Name' : 'Nickname'}</TableCell>
            <TableCell key={`addrName-b`}>
              {node.name ? <LinkedCell text={node.name} onLinkClick={() => {
                const rendered = staticState.peekRenderedNode(node.id) as RenderedNode
                focusCam(rendered)
                return false
              }} /> : makeupName(node.id, true)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell key={`addr-eth`}>ETH Balance</TableCell>
            <TableCell><LinkedCopyCell text={weiToEth(wei252ToBigInt(node.eth))} /></TableCell>
          </TableRow>
          <TableRow>
            <TableCell key={`addr-eth`}>WEI Balance</TableCell>
            <TableCell><LinkedCopyCell text={radix252ToDecimal(node.eth)} /></TableCell>
          </TableRow>
          {timelineCursors.length === 0 ? null : <TableRow>
            <TableCell key={`addr-last`}>Last Seen</TableCell>
            <TableCell>{new Date(timelineCursors[timelineCursors.length - 1][0]).toLocaleString()}</TableCell>
          </TableRow>}
          {timelineCursors.length === 0 ? null : <TableRow>
            <TableCell key={`addr-first`}>First Seen</TableCell>
            <TableCell>{new Date(timelineCursors[0][0]).toLocaleString()}</TableCell>
          </TableRow>}</Fragment>
      ) : loadingRow}
    </TableBody></Table>
  </Fragment>
}

function BlockPopup(
  node: Block,
  focusCam: FocusCam,
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>) {
  const blockIdUi = <TableRow key="blockid">
    <TableCell key={`blockid-a`}>Block Number</TableCell>
    <TableCell key={`blockid-b`}>
      {parseBlockNumber(node.id).toString(10)}
    </TableCell>
  </TableRow>

  console.log('aaaa ' + JSON.stringify(node, null, 2));
  return <Fragment key={'block' + node.id}>
    <Typography component="h2" variant="h5" color="primary" gutterBottom>
      {getDescription(node)}
    </Typography>
    <Table size="medium"><TableBody>
      {blockIdUi}
      {isFullBlock(node) ? (<Fragment key='loaded'><TableRow>
        <TableCell key={`minedat-a`}>Created At</TableCell>
        <TableCell key={`mindat-b`}>
          {radix252ToHumanDate(node.ts)}
        </TableCell>
      </TableRow>
        <TableRow key="miner">
          <TableCell key={`miner-a`}>{'Miner'}</TableCell>
          <TableCell key={`miner-b`}>
            <LinkedCopyCell text={'0x' + radix252ToHex(node.miner)} onLinkClick={() => {
              const minerId = newHexValuedId(radix252ToHex(node.miner), ADDRESS_TYPE)
              const rendered = staticState.peekRenderedNode(minerId)

              const loadAction: AQueried<LoadNodeSpec> = {
                type: 'Queried',
                spec: {
                  t: '0',
                  nId: minerId,
                  sel: '1',
                }
              }

              dispatch(loadAction)
              /*if (rendered) {
                focusCam(rendered)
              }*/
              return false
            }} />
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell key={`gasUsedBlock-a`}>Total Gas Used (Wei)</TableCell>
          <TableCell key={`gasUsedBlock-b`}>
            {radix252ToDecimal(node.gasUsed)}
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell key={`gasUsedBlock-a`}>Gas Limit (Wei)</TableCell>
          <TableCell key={`gasUsedBlock-b`}>
            {radix252ToDecimal(node.gasLimit)}
          </TableCell>
        </TableRow>
        {!node.extraData ? null : <TableRow>
          <TableCell key={`gasUsedBlock-a`}>Data</TableCell>
          <TableCell key={`gasUsedBlock-b`}>
            {node.extraData}
          </TableCell>
        </TableRow>}
      </Fragment>) : loadingRow}
    </TableBody></Table>
  </Fragment>
}

function TransactionPopup(
  node: Transaction,
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>) {
  const description = <Typography component="h2" variant="h5" color="primary" gutterBottom>
    {getDescription(node)}
  </Typography>
  const hashUi = <TableRow key="fromhash">
    <TableCell key={`fromhash-a`}>Unique Hash</TableCell>
    <TableCell key={`fromhash-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
      {parseHexId(node.id)}
    </TableCell>
  </TableRow>

  //@ts-ignore
  console.log('aaaa ' + JSON.stringify(node, null, 2));
  return <Fragment key={'tx-' + node.id}>
    {description}
    <Table size="medium"><TableBody>
      {hashUi}{isFullTransaction(node) ? (<Fragment>
        <TableRow key="txval">
          <TableCell key={`txid-a`}>ETH sent</TableCell>
          <TableCell key={`txid-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
            {weiToEth(wei252ToBigInt(node.eth))}
          </TableCell>
        </TableRow>
        <TableRow key="gas">
          <TableCell key={`txwei-a`}>Wei Sent</TableCell>
          <TableCell key={`txwei-b`}>
            {wei252ToBigInt(node.eth).toString()}
          </TableCell>
        </TableRow>
        <TableRow key="fromhash">
          <TableCell key={`fromhash-a`}>From Address</TableCell>
          <TableCell key={`fromhash-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
            <LinkedCopyCell text={`${node.from}`} onLinkClick={(e) => {
              const loadAction: AQueried<LoadNodeSpec> = {
                type: 'Queried',
                spec: {
                  t: '0',
                  nId: newHexValuedId(node.from, ADDRESS_TYPE),
                  sel: '1',
                }
              }

              dispatch(loadAction)
              return false
            }} />
          </TableCell>
        </TableRow>
        <TableRow key="tohash">
          <TableCell key={`tohash-a`}>To Address</TableCell>
          <TableCell key={`tohash-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
            <LinkedCopyCell text={`${node.to}`} onLinkClick={() => {
              const loadAction: AQueried<LoadNodeSpec> = {
                type: 'Queried',
                spec: {
                  t: '0',
                  nId: newHexValuedId(node.to, ADDRESS_TYPE),
                  sel: '1',
                }
              }
              dispatch(loadAction)
              return false
            }} />
          </TableCell>
        </TableRow>
        <TableRow key="gasPrice">
          <TableCell key={`gasPrice-a`}>Gas Price (WEI)</TableCell>
          <TableCell key={`gasPrice-b`} style={{ maxWidth: '10vw', wordWrap: 'break-word' }}>
            {radix252ToDecimal(node.gasPrice)}
          </TableCell>
        </TableRow>
        <TableRow key="txblockNumber">
          <TableCell key={`txblockNumber-a`}>Block Number</TableCell>
          <TableCell key={`txblockNumber-b`}>
            <LinkedCopyCell text={radix252ToDecimal(node.blockNumber)} onLinkClick={() => {
              const loadAction: AQueried<LoadNodeSpec> = {
                type: 'Queried',
                spec: {
                  t: '0',
                  nId: newNumberValuedId(fromRadix252(node.blockNumber), BLOCK_TYPE),
                  sel: '1',
                }
              }
              dispatch(loadAction)
              return false
            }} />
          </TableCell>
        </TableRow>
      </Fragment>) : loadingRow}
    </TableBody></Table>
  </Fragment>
}

function render(ref: MutableRefObject<any>, renderedNodes: JSX.Element, state: GraphState, dispatch: ReturnType<typeof useDispatch<AppDispatch>>, focusCam: FocusCam) {
  const closeClicked = () => {
    dispatch({ type: 'SelectedClosed' })
  }

  const focusClicked = () => {
    const rendered = staticState.peekRenderedNode(state.selectedNode!) as RenderedNode
    focusCam(rendered)
  }

  const clazz = state.popup.openCount === 1 ? 'scale-from-zero' : 'scale-from-close'
  return (
    <Draggable handle="#popupbar" bounds="parent" nodeRef={ref} enableUserSelectHack={true}>
      <div className={clazz} id="popup" ref={ref}>
        <AppBar id="popupbar" className="color-from-close" position="relative">
          <Toolbar sx={{ flexDirection: 'row-reverse' }}>
            <ButtonGroup color="secondary">
              <Tooltip title='Focus on selected + 1 degree'>
                <Button variant="outlined" onClick={focusClicked} startIcon={<VisibilityIcon />}>Focus</Button>
              </Tooltip>
              <Tooltip title='Copy a sharable link'>
                <Button variant="outlined" startIcon={<LinkIcon />}>Share</Button>
              </Tooltip>
              <Tooltip title='Close'>
                <Button color="error" onClick={closeClicked} ><CloseIcon /></Button>
              </Tooltip>
            </ButtonGroup>
          </Toolbar>
        </AppBar>
        {renderedNodes}
      </div>
    </Draggable>
  );
}

function renderClosed(ref: MutableRefObject<any>, renderedNodes: JSX.Element, state: GraphState, dispatch: ReturnType<typeof useDispatch<AppDispatch>>) {
  const openClicked = () => {
    dispatch({ type: 'SelectedOpened' })
  }

  return (
    <div className="scale-from-open" id="popup" ref={ref} >
      <AppBar id="popupbar" className="color-from-open" position="relative" style={{ padding: '0', margin: '0', display: state.popup.openCount === 0 ? 'none' : 'inherit' }}>
        <Toolbar style={{ padding: '0', margin: '0', minHeight: '0' }}>
          <ButtonGroup color="secondary" style={{ margin: '0', padding: '3px' }}>
            <Tooltip title='Open' style={{ margin: '0' }}>
              <Button color="error" onClick={openClicked}><FullscreenIcon /></Button>
            </Tooltip>
          </ButtonGroup>
        </Toolbar>
      </AppBar>
      {renderedNodes}
    </div>
  );
}

export function Popup(props: {
  focusCam: FocusCam,
  dispatch: AppDispatch
  state: GraphState
}) {

  const state = props.state
  const dispatch = props.dispatch
  const popupRef = useRef()
  const renderedNodes = //useMemo(() =>
    renderNode(state.selectedNode!, dispatch, state.timelineMark, state.timelineRels, state.timelineCursors, props.focusCam)//, [state.nodeDataHash, state.selectedNodes, state.selectedRels, state.timelineMark, state.timelineCursors])

  return state.popup.openCount === 0 || state.popup.minimized ?
    renderClosed(popupRef, renderedNodes, state, dispatch) :
    render(popupRef, renderedNodes, state, dispatch, props.focusCam)
}
