import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label
} from 'recharts';

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
}

export default function SensorPlot({ title, data }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10);
    return () => clearInterval(t);
  }, []);

  const WINDOW_MS = 20000;
  const minTime = now - WINDOW_MS;
  const chartData = (data || []).filter(d => d.time >= minTime && d.time <= now);

  // y-range
  let minY = 0, maxY = 10;
  if (chartData.length) {
    minY = Math.floor(Math.min(...chartData.map(d => d.value)) * 2) / 2;
    maxY = Math.ceil (Math.max(...chartData.map(d => d.value)) * 2) / 2;
    if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  }
  const ticks = [];
  for (let t = minY; t <= maxY + 1e-9; t += 0.5) ticks.push(Number(t.toFixed(2)));

  // ---- Layout knobs ----
  // Height is now driven by a CSS variable (--card-h) so visuals can be adjusted responsively in CSS
  const CARD_PAD = 12;                     // overall padding
  const LEFT_MARGIN = 16;                  // tiny gap between plot area & card border
  const LABEL_BORDER_GAP = 8;              // how close label sits to the card border

  return (
    <div style={{
      width: '100%',
      height: 'var(--card-h, 300px)',
      padding: CARD_PAD,
      background: '#fff',
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* keep title close to the top edge */}
      <h3 style={{ margin: '0 0 6px 0', textAlign: 'center' }}>{title}</h3>

      {/* chart fills all remaining space */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 8, left: LEFT_MARGIN, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" />

            <XAxis
              dataKey="time"
              type="number"
              domain={[minTime, now]}
              tickFormatter={formatTime}
              interval="preserveStartEnd"
              tick={{ fontSize: 14 }}
              tickMargin={8}
            >
              <Label
                value="Time (hh:mm:ss)"
                position="insideBottom"
                offset={-16}
                style={{ textAnchor: 'middle', fontSize: 16, fill: '#333', fontWeight: 'bold' }}
              />
            </XAxis>

            <YAxis
              domain={[minY, maxY]}
              ticks={ticks}
              tickFormatter={v => v.toFixed(2)}
              tick={{ fontSize: 14 }}
              tickMargin={10}                         // gap between tick numbers and axis line
            >
              {/* Title inside the plot, pushed LEFT so it's very close to the card edge */}
              <Label
                value="Sensor output (mV)"
                angle={-90}
                position="insideLeft"
                offset={-(LEFT_MARGIN - LABEL_BORDER_GAP)} // ~4px from card border
                style={{ textAnchor: 'middle', fontSize: 16, fill: '#333', fontWeight: 'bold' }}
              />
            </YAxis>

            <Tooltip labelFormatter={formatTime} formatter={v => Number(v).toFixed(2)} />
            <Line type="monotone" dataKey="value" stroke="#0000ff" dot={false} isAnimationActive={false} strokeWidth={2.2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}