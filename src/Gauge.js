import React from 'react';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

/**
 * Gauge component
 * Props:
 *  - value: number
 *  - label: string
 *  - min: number
 *  - max: number
 *  - hideLabel: boolean (if true, don't render the small label under the dial)
 */
function Gauge({ value = 0, label = '', min = 0, max = 100, hideLabel = false }) {
  const clampedValue = Number.isFinite(value) ? value : 0;
  const percentage = ((clampedValue - min) / (max - min)) * 100;
  const pct = Math.max(0, Math.min(100, percentage));

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: 200,
      boxSizing: 'border-box'
    }}>
      <div style={{ width: 140, height: 140 }}>
        <CircularProgressbar
          value={pct}
          text={`${clampedValue.toFixed(2)}`}
          styles={buildStyles({
            textColor: "#000",
            pathColor: "#007bff",
            trailColor: "#eee",
            textSize: '22px'
          })}
        />
      </div>
      {!hideLabel && (
        <div style={{ marginTop: 8 }}>
          <b>{label}</b>
        </div>
      )}
    </div>
  );
}

export default Gauge;