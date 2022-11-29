import Slider from "@mui/material/Slider";
import cloneDeep from 'lodash.clonedeep';
import React, { useMemo, useRef } from "react";
import { useDispatch } from "react-redux";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip as GraphTooltip, XAxis,
  YAxis
} from 'recharts';
import { AppDispatch } from "../../app/store";
import { GraphCursor } from './global/fetch-contract';
import { GraphNodes, isChildTransaction, isContractCreated, isMiner, isParentBlock, isRx, isTx, PaginatedNode, Relations } from "./global/types";
import { assertUnreachable, froRadix252, weiToEth } from "./global/utils";
import { AQueried, LoadTimelineMarkSpec, TimelineCursor } from "./graph-reducer";

// Returns selected node's past and future's closest GraphCursors to date or
// undefined if unloaded, null if known to have no more pages
const findClosestGraphCursors = function (timelineCursors: TimelineCursor[], timeMs: number): [GraphCursor, GraphCursor | null | undefined, number] {
  if (timelineCursors.length === 0) {
    throw new Error('Timeline code triggered before ready?')
  }
  for (let i = timelineCursors.length - 1; true; i--) {
    const page = timelineCursors[i]
    if (i === 0 || page[0] <= timeMs) {
      const nextPageCursor = (i + 1) < timelineCursors.length ? timelineCursors[i + 1][1] : undefined
      return [page[1] as GraphCursor, nextPageCursor, i]
    }
  }
}

type HistogramDatum = { id: Relations['id'], eth: number, ts: number, name: string }
export function Histogram(props: {
  data: HistogramDatum[],
  onBarClick: (datum: HistogramDatum) => unknown,
}) {
  return <ResponsiveContainer key="histo" width="100%" height={300}>
    <BarChart key="bar"
      data={props.data}
      margin={{
        top: 20,
        right: 10,
        left: 0,
        bottom: 20,
      }}
    >
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <GraphTooltip />
      <ReferenceLine y={0} stroke="#000" />
      <Bar dataKey="eth" fill="#3fed05" onClick={props.onBarClick}>
        {
          props.data.map((entry) => {
            const color = entry.eth > 0 ? "#3fed05" : "#ad0600"
            return <Cell key={`histo_bar_${entry.id}`} fill={color} />
          })
        }
      </Bar>
    </BarChart>
  </ResponsiveContainer>
}

function histogramDate(ms: number) {
  const asDate = new Date(ms);
  return `${asDate.getMonth() + 1}/${asDate.getDate()}/${asDate.getFullYear() % 100}`;
}

// Label only the ticks that don't overlap
function sanitizeTicks(
  ticks: { value: number, label: string }[],
  maxTicks: number,
  widthPx: number) {
  const sanitized = cloneDeep(ticks)
  const removalIndexes1 = []

  // First, filter the ticks down to maxTicks
  if (maxTicks < ticks.length) {
    const maxPeriod = Math.ceil(
      (ticks[ticks.length - 1].value - ticks[0].value) / maxTicks
    );
    let lastTickMs = ticks[0].value - maxPeriod
    for (let i = 0; i < ticks.length; i++) {
      const s = ticks[i];
      if (s.value < lastTickMs + maxPeriod) {
        removalIndexes1.push(i)
      } else {
        lastTickMs += maxPeriod
      }
    }
    removalIndexes1.reverse()
    for (const ri of removalIndexes1) {
      sanitized.splice(ri, 1)
    }
  }

  // Then, filter tick labels down to maxLabeledTicks
  const maxLabelWidth = 60
  const timeToPxScalar = widthPx / (sanitized[sanitized.length - 1].value - sanitized[0].value)
  let lastTickPx = sanitized[0].value * timeToPxScalar;
  for (let i = 0; i < sanitized.length; i++) {
    const curTickPx = sanitized[i].value * timeToPxScalar;
    if (i === 0) {
      lastTickPx = curTickPx
    }
    else if ((curTickPx > maxLabelWidth / 2) || (
      i > 1 && curTickPx < maxLabelWidth / 2) || curTickPx < (lastTickPx + maxLabelWidth)) {
      sanitized[i].label = ""
    } else {
      lastTickPx = curTickPx
    }
  }
  return sanitized
}

function getThumbWidthPercent(viewCount: number, tickCount: number) {
  return `${Math.round(100 * viewCount / tickCount)}%`
}

function barClicked(datum: HistogramDatum) {
  // TODO: Set selected Relation and zoom in on it...
  // or maybe select the other end of the rel?
}

function timelineClicked(
  newTimelineMark: number,
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>,
  selectedNode: PaginatedNode,
  timelineCursors: TimelineCursor[]) {

  const [prev, next] = findClosestGraphCursors(timelineCursors, newTimelineMark);
  const query: AQueried<LoadTimelineMarkSpec> = {
    type: 'Queried',
    spec: {
      t: '3',
      n: selectedNode.id,
      f: prev,
      s: next || undefined,
      m: newTimelineMark.toString(),
    },
  }
  dispatch(query)
}

function relationToWei(rel: Relations): bigint {
  if (isTx(rel) || isContractCreated(rel)) {
    return -froRadix252(rel.val)
  } else if (isRx(rel)) {
    return froRadix252(rel.val)
  } else if (isParentBlock(rel) || isChildTransaction(rel)) {
    return BigInt(0)
  } else if (isMiner(rel)) {
    // TODO: Make mined wei accurate!!!
    return rel.val ? froRadix252(rel.val!) : BigInt('3000000000000000000')
  }
  assertUnreachable(rel)
}

export function Timeline(props: {
  dispatch: ReturnType<typeof useDispatch<AppDispatch>>,
  selectedNode: GraphNodes,
  timelineMark: number,
  timelineCursors: TimelineCursor[],
  timelineRels: Relations[],
}) {
  const { dispatch, selectedNode, timelineRels, timelineCursors, timelineMark } = props
  const ref = useRef<HTMLDivElement>(null);
  const widthPx = ref.current?.clientWidth || 300
  //const histogram = //useMemo(() => {
  if (timelineRels.length === 0) {
    // TODO: loading bar
  }
  const histogramData = timelineRels.map((tr) => {
    const eth = +weiToEth(relationToWei(tr))
    return {
      id: tr.id,
      eth,
      ts: Number(froRadix252(tr.ts)),
      name: histogramDate(Number(froRadix252(tr.ts)) * 1000)
    }
  })
  const histogram = <Histogram
    key="selectedHistogram"
    onBarClick={(datum) => barClicked(datum as HistogramDatum)}
    data={histogramData} />
  //}, [timelineRels])

  const slider = useMemo(() => {
    if (timelineCursors.length === 0) {
      return null;
    }
    const minValue = timelineCursors[0][0]
    const maxValue = timelineCursors[timelineCursors.length - 1][0]
    const cursorTicks = timelineCursors.map((tc) => ({
      value: tc[0],
      label: histogramDate(tc[0]),
    }))

    return (<div style={{
      marginLeft: "25px",
      marginRight: "25px",
      overflow: 'visible'
    }} ref={ref}>
      {timelineCursors.length > 1 ? <Slider
        defaultValue={30}
        value={timelineMark}
        min={minValue}
        max={maxValue}
        step={null}
        onChange={(e, value) => timelineClicked(
          value as number, dispatch, selectedNode as PaginatedNode, timelineCursors)}
        marks={sanitizeTicks(cursorTicks, 40, widthPx)}
        sx={{
          width: "100%",
          overflow: 'visible',
          color: "#ddd",
          "& .MuiSlider-thumb": {
            borderRadius: "1px",
            width: getThumbWidthPercent(20, 400),
            color: "#5397f5"
          }
        }}
      /> : null}
    </div>)
  }, [selectedNode, dispatch, widthPx, timelineMark, timelineCursors])
  return <React.Fragment>
    {histogram}
    {slider}
  </React.Fragment>
}
