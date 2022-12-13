import { forceCollide, forceLink, forceManyBody } from 'd3-force';
import isEqual from 'lodash.isequal';
import memoizee from 'memoizee';
import { MutableRefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { NodeObject } from 'react-force-graph-3d';
import ForceGraphVR from 'react-force-graph-vr';
import { useDispatch } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { GlobalStateProps } from '../../App';
import { useAppSelector } from '../../app/hooks';
import { AppDispatch } from '../../app/store';
import { Toast } from '../dashboard/Toast';
import { Address, getGraphType, GraphNodes, isAddress, isBlock, isFullTransaction, isTransaction, parseBlockNumber, RX, TX } from './global/types';
import { assertUnreachable, densure, wei252ToBigInt, instrumentDebug, makeupName, radix252ToDecimal, weiToEth } from './global/utils';
import { ANodeSelected, AQueried, AUrlQueryUpdated, LoadLatestBlockSpec, LoadNodeSpec, staticState } from './graph-reducer';
import { HomeDialog } from './HomeDialog';
import { Popup } from './Popup';
import { BLOCK_NODE_DISTANCE, createThreeObj, getLinkColor, getLinkWidth, isRenderedLink, LinkView, RenderedLinkView, RenderedNode, TIME_TILL_FREEZE, toGraphViewNodes, unfreezeAll } from './rendering';
import { NavSearch } from './search';
import { Settings } from './Settings';

const CAM_MOVE_DURATION = 1000;

// SPECIAL! On first draw, load remotely to depth X!
//const INIT_DRAW_LOAD_MAX_DEPTH = 2;

let zoomTimer = setTimeout(() => { }, 0)

const debug = instrumentDebug('Graph')

/*function preventDefault(event: React.MouseEvent) {
  event.preventDefault();
}*/

export type Point3d = {
  x: number,
  y: number,
  z: number,
}

// This is a sloppy way to expose the camera in a static way, but it works
// since Sagas need access here
let graphRef: MutableRefObject<unknown> | null = null
export const focusCam = (node: RenderedNode) => {
  //@ts-ignore
  if (!graphRef || !graphRef.current || !graphRef.current.cameraPosition || !Number.isFinite(node.x)) {
    return
  }
  /*if (state.settings.vrEnabled) {
    return
  }*/

  //@ts-ignore
  const cam = graphRef.current.cameraPosition() as { x: number, y: number, z: number }

  // Aim at node from outside it
  const defaultDistance = 180

  const curDistance = Math.sqrt(Math.pow(cam.x - node.x, 2) + Math.pow(cam.y - node.y, 2) + Math.pow(cam.z - node.z, 2))
  const idealDistance = curDistance + (defaultDistance - curDistance) * 0.75

  // Find the "ideal" camera position between it's current location and
  // the node to focus on
  const idealPos = findIdealPointBetween(idealDistance, cam, { x: node.x || 0, y: node.y || 0, z: node.z || 0 })

  //@ts-ignore
  graphRef.current.cameraPosition(
    idealPos, // new position
    node, // lookAt ({ x, y, z })
    CAM_MOVE_DURATION // ms transition duration
  )
}

export const zoomToFit = (delay: number = 0) => {
  // @ts-ignore
  if (!graphRef || !graphRef.current || !graphRef.current.zoomToFit) {
    return
  }
  clearTimeout(zoomTimer)
  zoomTimer = setTimeout(() => {
    // @ts-ignore
    graphRef.current.zoomToFit(180, 0);
    // zoomToFit not avail in VR mode
    /*if (!state.settings.vrEnabled) {
    }*/
  }, delay)
}

function findIdealPointBetween(circleRadius: number, linePoint0: Point3d, linePoint1: Point3d): Point3d {
  const cx = linePoint1.x
  const cy = linePoint1.y
  const cz = linePoint1.z

  const px = linePoint0.x;
  const py = linePoint0.y;
  const pz = linePoint0.z;

  const vx = linePoint1.x - px;
  const vy = linePoint1.y - py;
  const vz = linePoint1.z - pz;

  const A = vx * vx + vy * vy + vz * vz;
  const B = 2.0 * (px * vx + py * vy + pz * vz - vx * cx - vy * cy - vz * cz);
  const C = px * px - 2 * px * cx + cx * cx + py * py - 2 * py * cy + cy * cy +
    pz * pz - 2 * pz * cz + cz * cz - circleRadius * circleRadius;

  // discriminant
  // Tested taking the abs, it just works but not 100% sure why lol
  const D = Math.abs(B * B - 4 * A * C);

  const t1 = (-B - Math.sqrt(D)) / (2.0 * A);

  const solution1 = {
    x: linePoint0.x * (1 - t1) + t1 * linePoint1.x,
    y: linePoint0.y * (1 - t1) + t1 * linePoint1.y,
    z: linePoint0.z * (1 - t1) + t1 * linePoint1.z
  };
  if (D === 0) {
    return solution1;
  }

  const t2 = (-B + Math.sqrt(D)) / (2.0 * A);
  const solution2 = {
    x: linePoint0.x * (1 - t2) + t2 * linePoint1.x,
    y: linePoint0.y * (1 - t2) + t2 * linePoint1.y,
    z: linePoint0.z * (1 - t2) + t2 * linePoint1.z
  };

  // prefer a solution that's on the line segment itself
  if (Math.abs(t1 - 0.5) < Math.abs(t2 - 0.5)) {
    return solution1//, solution2 };
  }

  return solution2
}

const nodeToLabel = (node: NodeObject | GraphNodes): string => {
  const asRendered = node as GraphNodes
  if (isAddress(asRendered)) {
    return asRendered.name || makeupName(asRendered.id, true)
  }
  else if (isBlock(asRendered)) {
    return `Block ${parseBlockNumber(asRendered.id)}`
  } else if (isTransaction(asRendered)) {
    let txName = isFullTransaction(asRendered) ? `${weiToEth(wei252ToBigInt(asRendered.eth)).substring(0, 10)} ETH\r\n` : ''
    // Transactions mostly make sense in terms as a relation, find a send or receive and name based on that
    const rels = staticState.peekNodeRelations(asRendered.id) || []
    for (const rel of rels) {
      if (getGraphType(rel.id) === TX) {
        const from = rel.source as Address
        const to = rel.target as Address
        const fromName = from.name || makeupName(from.id, true)
        const toName = to.name || makeupName(to.id, true)
        txName += `${fromName} to ${toName}`
        break
      } else if (getGraphType(rel.id) === RX) {
        const from = rel.target as Address
        const to = rel.source as Address
        const fromName = from.name || makeupName(from.id, true)
        const toName = to.name || makeupName(to.id, true)
        console.log('pos tooo' + JSON.stringify(to, null, 2));
        txName += `${fromName} to ${toName}`
        break
      }
    }
    return txName
  } else {
    assertUnreachable(asRendered)
  }
}

export type GraphProps = GlobalStateProps & {}

// This sucks, but I don't know how to coordinate history with internal query changes otherwise!
let skipNextQueryDisagreementHack = false

// Fetch and remember last visible links call
const getVisibleLinks = memoizee((relsHash: string) => staticState.peekVisibleLinks(), {
  max: 1
})

export default function GraphWrap(props: GraphProps) {
  const dispatch = useDispatch<AppDispatch>()
  const [queryParams, setSearchParams] = useSearchParams()
  const state = useAppSelector((s) => s.graph)
  const defaultInitQuery = new URLSearchParams(
    { t: '1', c: /*props.globalState.eth?.bn ||*/ '8964209', m: state.settings.maxNodes.toString() } as LoadLatestBlockSpec
  )
  const graphRelViews = getVisibleLinks(state.relsDataHash)
  const graphRenderedNodes: RenderedNode[] = useMemo(
    () => toGraphViewNodes(state.settings.viewMode, state.selectedNode),
    [state.nodeDataHash, state.settings.viewMode, state.settings.maxNodes]);
  const gRef = useRef()
  graphRef = gRef
  const wrapperRef = useRef(null)

  // Initialize window resize listener
  useEffect(() => {
    function handleResize() {
      if (wrapperRef.current) {
        const { current } = wrapperRef
        //@ts-ignore
        const boundingRect = current.getBoundingClientRect()
        const { width, height } = boundingRect
        dispatch({ type: 'GraphDimsChanged', width, height })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  });

  // Initialize camera
  useEffect(() => {
    if (!state.camera.initialized && state.query && state.nodeDataHash !== '') {
      dispatch({ type: 'CameraInitialize' });
      // Do an init reset to get roughly correct,
      setTimeout(() => zoomToFit(1900), 1000)
      // After physics has chilled out a bit, finalize the camera
      setTimeout(() => zoomToFit(1000), TIME_TILL_FREEZE + 500)
    }
    if (state.nodeDataHash === '') {

    }
  })

  useEffect(() => {
    if (gRef) {
      //@ts-ignore
      gRef.current.d3Force('center', null);
      //@ts-ignore
      gRef.current.d3Force('link', null);
      //@ts-ignore
      gRef.current.d3Force('charge', null)
      //@ts-ignore
      gRef.current.d3Force('charge', forceManyBody().strength(-0.5).distanceMax(BLOCK_NODE_DISTANCE * 10))
      //.distanceMax(20)
      //@ts-ignore
      gRef.current.d3Force('link', forceLink().strength(1.5).distance(BLOCK_NODE_DISTANCE / 2))
      //@ts-ignore
      gRef.current.d3Force('collide', forceCollide(22).strength(0.7))
    }
  }, [])

  // Resolve differences of state opinion between URL params & Redux state...
  //useEffect(() => {
  const urlParams = (queryParams.toString() === '') ? defaultInitQuery : queryParams
  const queryMap = {} as Record<string, string>
  for (const entry of urlParams.entries()) {
    queryMap[entry[0]] = entry[1]
  }
  const queriesAgree = isEqual(queryMap, state.query)
  const internalChanged = state.query && state.urlQueryStale
  if (!queriesAgree) {
    // Case 1: New internal Query was set, push it to URL history
    if (internalChanged) {
      // Because we are mutating TWO pieces of state, we have to hackily skip
      // checking for query disagreement on the next render exactly once
      skipNextQueryDisagreementHack = true
      debug('Applying from internal: ' + JSON.stringify(state.query))
      const newUrlParams = new URLSearchParams(state.query!)
      //setTimeout(() => {
      dispatch({ type: 'UrlQueryUpdated' } as AUrlQueryUpdated);
      setSearchParams(newUrlParams)
      //}, 0)
    }
    // Case 2: External URL changed, update internal Query
    else if (!skipNextQueryDisagreementHack) {
      debug('Applying from URL: ' + JSON.stringify(queryMap))
      //setTimeout(() => {
      dispatch({ type: 'Queried', spec: queryMap, isExternal: true } as AQueried);
      //}, 0)
    } else {
      skipNextQueryDisagreementHack = false
    }
  }
  //})

  const handleBgClick = () => {
    if (state.selectedNode) {
      dispatch({
        type: 'NodeSelect',
        nodeId: null,
        prevId: state.selectedNode!,
      } as ANodeSelected<null>)
    }
  }

  const handleNodeClick = (eventNode: unknown) => {
    const node: RenderedNode = eventNode as RenderedNode;
    const nodeId = node.id as GraphNodes['id'];
    const querySpec = { t: '0', nId: nodeId, sel: '1' } as LoadNodeSpec;
    dispatch({ type: 'Queried', spec: querySpec })
    densure('Issued findNode query for ' + nodeId, !!nodeId && nodeId.length > 0)

    /*if (state.popup.openCount < 1 || state.settings.autoFocus) {
      focusCam(node)
    }*/
    return false
  }

  const handleLinkClick = (eventLink: unknown) => {
    const link: LinkView = eventLink as LinkView;
    if (isRenderedLink(link)) {
      //dispatch({ type: 'RelsSelect', rels: [link]});
      /*const nodes = [link.source, link.target];
      const avgPos = [(nodes[1].x + nodes[0].x) / 2, (nodes[1].y + nodes[0].y) / 2, (nodes[1].z + nodes[0].z) / 2];
      const distance = 120;
      const distRatio = 1 + distance / Math.hypot(avgPos[0], avgPos[1], avgPos[2]);

      const newPos = avgPos[0] || avgPos[1] || avgPos[2]
        ? { x: avgPos[0] * distRatio, y: avgPos[1] * distRatio, z: avgPos[2] * distRatio }
        : { x: 0, y: 0, z: distance }; // special case if node is in (0,0,0)

      //@ts-ignore
      fgRef.current.cameraPosition(
        newPos, // new position
        avgPos, // lookAt ({ x, y, z })
        1000  // ms transition duration
      );*/
    }
  }

  /*const handleEngineStop = () => {
    if (state.nodeDataHash === '') {
      return;
    }
  }*/

  const memoHandleLinkClick = useCallback(handleLinkClick, [])
  //const memoCreateThreeObj = useCallback(createThreeObj, [])

  const graph = useMemo(() => {
    debug('Graph render')
    if (state.settings.vrEnabled) {
      return <ForceGraphVR
        ref={gRef}
        nodeLabel={nodeToLabel}
        width={state.windowDims[0]}
        height={state.windowDims[1]}
        cooldownTime={TIME_TILL_FREEZE}
        graphData={({ nodes: graphRenderedNodes, links: graphRelViews })}
        linkDirectionalParticles={1.2}
        linkDirectionalParticleWidth={1.3}
        linkDirectionalParticleColor={() => 'rgb(255,255,50)'}
        linkWidth={(link: any) => getLinkWidth(link as RenderedLinkView, state.selectedNode)}
        linkDirectionalParticleSpeed={() => 0.005}
        linkColor={(link: any) => getLinkColor(link as LinkView, state.selectedNode)}
        onNodeClick={handleNodeClick}
        //onBackgroundClick={handleBgClick}
        //onLinkClick={memoHandleLinkClick}
        warmupTicks={10}
        nodeOpacity={0.8}
        nodeThreeObject={(n) => createThreeObj(n as RenderedNode)}
      />
    }
    return <ForceGraph3D
      ref={gRef}
      nodeLabel={nodeToLabel}
      backgroundColor="#000000"
      width={state.windowDims[0]}
      height={state.windowDims[1]}
      cooldownTime={TIME_TILL_FREEZE}
      graphData={({ nodes: graphRenderedNodes, links: graphRelViews })}
      linkDirectionalParticles={1.2}
      linkDirectionalParticleWidth={1.3}
      linkDirectionalParticleColor={() => 'rgb(255,255,50)'}
      linkWidth={(link: any) => getLinkWidth(link as RenderedLinkView, state.selectedNode)}
      linkDirectionalParticleSpeed={() => 0.005}
      linkColor={(link: any) => getLinkColor(link as LinkView, state.selectedNode)}
      onNodeClick={handleNodeClick}
      onBackgroundClick={handleBgClick}
      onLinkClick={memoHandleLinkClick}
      warmupTicks={10}
      nodeOpacity={0.8}
      controlType="orbit"
      nodeThreeObject={(n) => createThreeObj(n as RenderedNode)}
    />
  }, [state.nodeDataHash, state.relsDataHash, state.settings, state.windowDims, state.query, state.selectedNode, window.location.href, dispatch])

  return <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
    {graph}
    {state.selectedNode ? <Popup dispatch={dispatch} state={state} focusCam={focusCam} /> : ''}
    <Settings dispatch={dispatch} state={state} focusCam={focusCam} zoomToFit={zoomToFit} unfreezeAll={unfreezeAll} />
    <HomeDialog />
    <NavSearch dispatch={dispatch} isLoading={state.searchLoading} />
    <Toast notification={state.notification} />
  </div>;
}
