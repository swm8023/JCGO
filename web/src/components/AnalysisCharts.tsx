import { LineChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { useEffect, useMemo, useRef } from 'react'
import type { ChartPoint } from '../api/types'

echarts.use([GridComponent, LineChart, MarkLineComponent, SVGRenderer, TooltipComponent])

interface AnalysisChartsProps {
  points: ChartPoint[]
  currentMoveNumber?: number
  onJump(moveNumber: number): void
}

const chart = {
  width: 320,
  height: 112,
  left: 28,
  right: 28,
  top: 4,
  bottom: 18,
}

const plotWidth = chart.width - chart.left - chart.right

export function AnalysisCharts({ points, currentMoveNumber, onJump }: AnalysisChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const option = useMemo(() => buildChartOption(points, currentMoveNumber), [points, currentMoveNumber])
  const hitTargets = useMemo(() => buildHitTargets(points), [points])

  useEffect(() => {
    const element = chartRef.current
    if (!element) return

    const instance = echarts.init(element, null, { renderer: 'svg' })
    const resize = () => instance.resize()
    let observer: ResizeObserver | undefined

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize)
      observer.observe(element)
    } else {
      window.addEventListener('resize', resize)
    }

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    const element = chartRef.current
    const instance = element ? echarts.getInstanceByDom(element) : undefined
    instance?.setOption(option, true)
  }, [option])

  return (
    <div className="analysis-charts" aria-label="胜率曲线">
      <div className="rail-section-body chart-body">
        <div ref={chartRef} className="echarts-chart" role="img" aria-label="Winrate curve" />
        <div className="chart-click-layer">
          {hitTargets.map((target) => (
            <button
              key={target.moveNumber}
              type="button"
              aria-label={`Jump to move ${target.moveNumber}`}
              className="chart-hit-target"
              style={{ left: `${target.leftPercent}%`, width: `${target.widthPercent}%` }}
              onClick={() => onJump(target.moveNumber)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function buildChartOption(points: ChartPoint[], currentMoveNumber?: number): EChartsCoreOption {
  const maxMove = Math.max(1, ...points.map((point) => point.moveNumber))
  const scoreLimit = niceScoreLimit(points)
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: {
      left: chart.left,
      right: chart.right,
      top: chart.top,
      bottom: chart.bottom,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(184, 168, 152, 0.58)',
      borderWidth: 1,
      padding: [5, 7],
      textStyle: {
        color: '#1a1a2e',
        fontSize: 11,
        fontWeight: 600,
      },
      valueFormatter: (value: unknown) => (typeof value === 'number' ? value.toFixed(1) : `${value}`),
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: maxMove,
      splitNumber: 4,
      axisLine: {
        lineStyle: { color: 'rgba(184, 168, 152, 0.44)', width: 0.8 },
      },
      axisTick: {
        length: 3,
        lineStyle: { color: 'rgba(184, 168, 152, 0.44)', width: 0.8 },
      },
      axisLabel: {
        color: '#6b7280',
        fontSize: 9,
        fontWeight: 600,
        hideOverlap: true,
        margin: 5,
      },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#6b7280',
          fontSize: 9,
          fontWeight: 600,
          formatter: '{value}%',
          margin: 5,
        },
        splitLine: {
          lineStyle: { color: 'rgba(184, 168, 152, 0.28)', width: 0.6 },
        },
      },
      {
        type: 'value',
        min: -scoreLimit,
        max: scoreLimit,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#6b7280',
          fontSize: 9,
          fontWeight: 600,
          formatter: (value: number) => (value > 0 ? `+${value}` : `${value}`),
          margin: 5,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '黑胜率',
        type: 'line',
        data: points.map((point) => [point.moveNumber, round1(point.winrate * 100)]),
        smooth: true,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: {
          color: '#1a472a',
          width: 1.35,
        },
        itemStyle: { color: '#1a472a' },
        emphasis: {
          focus: 'series',
          lineStyle: { width: 1.65 },
        },
        markLine:
          currentMoveNumber === undefined
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                label: { show: false },
                lineStyle: {
                  color: 'rgba(26, 26, 46, 0.42)',
                  width: 0.8,
                  type: 'solid',
                },
                data: [{ xAxis: clamp(currentMoveNumber, 0, maxMove) }],
              },
      },
      {
        name: '目差',
        type: 'line',
        yAxisIndex: 1,
        data: points.map((point) => [point.moveNumber, round1(point.scoreLead)]),
        smooth: true,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: {
          color: '#c2410c',
          opacity: 0.54,
          width: 1,
        },
        itemStyle: { color: '#c2410c' },
        emphasis: {
          focus: 'series',
          lineStyle: { opacity: 0.76, width: 1.2 },
        },
      },
    ],
  }
}

function niceScoreLimit(points: ChartPoint[]) {
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.scoreLead)))
  return Math.ceil(maxAbs)
}

function buildHitTargets(points: ChartPoint[]) {
  const maxMove = Math.max(1, ...points.map((point) => point.moveNumber))
  const hitWidthPercent = ((Math.max(12, plotWidth / Math.max(points.length, 1)) / plotWidth) * 100)
  return points.map((point) => ({
    moveNumber: point.moveNumber,
    leftPercent: (point.moveNumber / maxMove) * 100,
    widthPercent: hitWidthPercent,
  }))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}
