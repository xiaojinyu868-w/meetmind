'use client';

// 困惑点热力图组件
// 复用 @nivo/heatmap (13.9k stars) 实现专业热力图可视化

import { ResponsiveHeatMap } from '@nivo/heatmap';
import { useMemo } from 'react';

export interface ConfusionData {
  timeSlot: string;  // '09:00-09:10'
  density: number;   // 困惑密度 0-100
  count: number;     // 困惑人数
}

interface ConfusionHeatmapProps {
  data: ConfusionData[];
  onCellClick?: (timeSlot: string) => void;
  height?: number;
  showLegend?: boolean;
}

export function ConfusionHeatmap({ 
  data, 
  onCellClick,
  height = 400,
  showLegend = true,
}: ConfusionHeatmapProps) {
  // 转换为 nivo 要求的数据格式
  const nivoData = useMemo(() => {
    if (!data || data.length === 0) {
      return [];
    }
    
    return data.map(item => ({
      id: item.timeSlot,
      data: [{
        x: '困惑密度',
        y: item.density,
      }]
    }));
  }, [data]);

  // 空数据状态
  if (!data || data.length === 0) {
    return (
      <div 
        className="flex items-center justify-center bg-gray-50 rounded-lg"
        style={{ height }}
      >
        <div className="text-center text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p>暂无困惑点数据</p>
          <p className="text-sm mt-1">学生标记困惑点后将在此显示</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveHeatMap
        data={nivoData}
        margin={{ top: 60, right: 90, bottom: 60, left: 90 }}
        valueFormat=">-.0f"
        axisTop={{
          tickSize: 5,
          tickPadding: 5,
          tickRotation: -45,
          legend: '时间段',
          legendOffset: 46
        }}
        axisLeft={{
          tickSize: 5,
          tickPadding: 5,
          legend: '指标',
          legendPosition: 'middle',
          legendOffset: -72
        }}
        colors={{
          type: 'sequential',
          scheme: 'reds'  // 红色渐变表示困惑程度
        }}
        emptyColor="#f5f5f5"
        onClick={(cell) => {
          onCellClick?.(cell.serieId as string);
        }}
        hoverTarget="cell"
        animate={true}
        motionConfig="gentle"
        legends={showLegend ? [
          {
            anchor: 'bottom',
            translateX: 0,
            translateY: 30,
            length: 400,
            thickness: 8,
            direction: 'row',
            tickPosition: 'after',
            tickSize: 3,
            tickSpacing: 4,
            tickOverlap: false,
            title: '困惑密度 →',
            titleAlign: 'start',
            titleOffset: 4
          }
        ] : []}
      />
    </div>
  );
}

/**
 * 从困惑点数据聚合为热力图数据
 */
export function aggregateConfusionData(
  anchors: Array<{ timestamp: number; status: string }>,
  totalDurationMs: number,
  intervalMinutes: number = 10
): ConfusionData[] {
  if (!anchors || anchors.length === 0 || totalDurationMs <= 0) {
    return [];
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  const totalSlots = Math.ceil(totalDurationMs / intervalMs);
  const result: ConfusionData[] = [];

  for (let i = 0; i < totalSlots; i++) {
    const startMs = i * intervalMs;
    const endMs = Math.min((i + 1) * intervalMs, totalDurationMs);
    
    // 计算该时间段内的困惑点数量
    const anchorsInSlot = anchors.filter(
      a => a.timestamp >= startMs && a.timestamp < endMs
    );
    
    const startMin = Math.floor(startMs / 60000);
    const endMin = Math.floor(endMs / 60000);
    const timeSlot = `${String(startMin).padStart(2, '0')}:00-${String(endMin).padStart(2, '0')}:00`;
    
    // 归一化到 0-100
    const density = Math.min(100, anchorsInSlot.length * 20);
    
    result.push({
      timeSlot,
      density,
      count: anchorsInSlot.length,
    });
  }

  return result;
}
