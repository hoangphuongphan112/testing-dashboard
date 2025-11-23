import React, { useEffect, useState, useRef } from 'react';
import client from './mqttService';
import SensorPlot from './SensorPlot';
import Gauge from './Gauge';
import './App.css';

const SENSOR_KEYS = [
  // piezo1 -> Sensor1:A1, Sensor2:B1, Sensor3:C1, Sensor4:A2
  'A1', 'B1', 'C1', 'A2',
  // piezo2 -> Sensor1:B2, Sensor2:C2, Sensor3:D1, Sensor4:E1
  'B2', 'C2', 'D1', 'E1',
  // piezo3 -> Sensor1:A3, Sensor2:B3, Sensor3:C3, Sensor4:A4
  'A3', 'B3', 'C3', 'A4',
  // piezo4 -> Sensor1:B4, Sensor2:C4, Sensor3:D2, Sensor4:E2
  'B4', 'C4', 'D2', 'E2'
];

const makeEmptyState = () => Object.fromEntries(SENSOR_KEYS.map(k => [k, []]));

function App() {
  const [piezo, setPiezo] = useState(makeEmptyState());
  const [temp1, setTemp1] = useState(0);
  const [hum1, setHum1] = useState(0);
  const [temp2, setTemp2] = useState(0);
  const [hum2, setHum2] = useState(0);
  const [decoderMode, setDecoderMode] = useState('original'); // 'original' or 'base64'
  const [isConnected, setIsConnected] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [lastMessage, setLastMessage] = useState(null);
  const [connectionEvents, setConnectionEvents] = useState([]);
  const [topicMessages, setTopicMessages] = useState({});

  // Running average offset (device time - browser time)
  const offsetRef = useRef(0);
  const offsetSamples = useRef([]);

  /**
   * Decode Piezo sensor batch data from Base64
   * Binary format (little-endian):
   * - uint32_t base_timestamp (4 bytes) - seconds
   * - uint16_t sample_interval_ms (2 bytes)
   * - uint8_t num_samples (1 byte)
   * - uint8_t num_channels (1 byte)
   * - int16_t values[num_channels * num_samples] (2 bytes each)
   * 
   * Values are stored in CHANNEL-MAJOR ORDER:
   * [ch0_s0, ch0_s1, ch0_s2, ..., ch0_sN, ch1_s0, ch1_s1, ..., ch1_sN, ...]
   */
  const decodePiezoData = (base64Data) => {
    try {
      // Decode Base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = bytes.buffer;
      const view = new DataView(buffer);
      
      // Read header (8 bytes)
      const baseTimestamp = view.getUint32(0, true); // little-endian, seconds
      const sampleIntervalMs = view.getUint16(4, true);
      const numSamples = view.getUint8(6);
      const numChannels = view.getUint8(7);
      
      console.log('  [Piezo Decode] Header:', { baseTimestamp, sampleIntervalMs, numSamples, numChannels });
      
      // Initialize arrays for each channel
      const channels = [];
      for (let ch = 0; ch < numChannels; ch++) {
        channels.push([]);
      }
      
      // Read sensor values - CHANNEL-MAJOR ORDER
      let offset = 8;
      let invalidCount = 0;
      
      for (let ch = 0; ch < numChannels; ch++) {
        for (let s = 0; s < numSamples; s++) {
          const rawValue = view.getInt16(offset, true); // signed int16, little-endian
          const timestamp = baseTimestamp * 1000 + (s * sampleIntervalMs);
          
          // Detects -32768 (0x8000) as the ONLY invalid data marker
          if (rawValue === -32768) {
            invalidCount++;
            console.log(`  [Piezo Decode] INVALID marker detected: sample=${s}, channel=${ch}, rawValue=${rawValue} (0x8000)`);
          } else {
            const voltage = rawValue / 100.0; // Convert from centimV to mV
            channels[ch].push({
              timestamp: timestamp,
              value: voltage
            });
          }
          
          offset += 2;
        }
      }
      
      console.log(`  [Piezo Decode] Decoded channels: ${channels.map((ch, i) => `Ch${i}: ${ch.length} valid samples`).join(', ')}`);
      if (invalidCount > 0) {
        console.log(`  [Piezo Decode] Filtered out ${invalidCount} invalid samples (0x8000 marker)`);
      }
      
      return { channels: channels, baseTimestamp, sampleIntervalMs };
    } catch (error) {
      console.error('Error decoding piezo base64 data:', error);
      return null;
    }
  };

  /**
   * Decode Temperature/Humidity data from Base64
   * Binary format (little-endian):
   * - uint32_t timestamp (4 bytes) - seconds
   * - int16_t temperature (2 bytes) - temp * 100 (signed)
   * - uint16_t humidity (2 bytes) - humidity * 100 (unsigned)
   * Total: 8 bytes
   */
  const decodeTempHumData = (base64Data) => {
    try {
      // Decode Base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = bytes.buffer;
      const view = new DataView(buffer);
      
      // Read fields (matches Python: struct.unpack('<IhH', binary_data))
      const timestamp = view.getUint32(0, true);  // uint32_t, little-endian
      const tempRaw = view.getInt16(4, true);     // int16_t (signed), little-endian
      const humRaw = view.getUint16(6, true);     // uint16_t (unsigned), little-endian
      
      const temperature = tempRaw / 100.0;
      const humidity = humRaw / 100.0;
      
      console.log('  [TempHum Decode]:', { timestamp, temperature: temperature.toFixed(2), humidity: humidity.toFixed(2) });
      
      return { timestamp, temperature, humidity };
    } catch (error) {
      console.error('Error decoding temp/hum base64 data:', error);
      return null;
    }
  };

  const toggleDecoderMode = () => {
    setDecoderMode(prev => prev === 'original' ? 'base64' : 'original');
    console.log('Decoder mode switched to:', decoderMode === 'original' ? 'base64' : 'original');
  };

  const addConnectionEvent = (event) => {
    const timestamp = new Date().toLocaleTimeString();
    setConnectionEvents(prev => [...prev, { time: timestamp, event }].slice(-10)); // Keep last 10 events
    console.log(`[${timestamp}] ${event}`);
  };

  useEffect(() => {
    const WINDOW_MS = 20000;        // 20 seconds
    const OFFSET_SAMPLE_SIZE = 20;  // samples for running offset avg

    const TOPIC_MAP = {
      'iot/piezo': ['A1', 'B1', 'C1', 'A2']
    };

    const subscribeTopics = [
      'iot/piezo',
      'iot/temp'
    ];

    const handleConnect = () => {
      console.log('✅ MQTT connected!');
      setIsConnected(true);
      addConnectionEvent('✅ Connected to MQTT broker');
      for (const t of subscribeTopics) {
        client.subscribe(t, err => {
          if (err) {
            console.error('❌ Subscribe error', t, err);
            addConnectionEvent(`❌ Failed to subscribe to ${t}`);
          } else {
            console.log('✅ Subscribed to:', t);
            addConnectionEvent(`✅ Subscribed to ${t}`);
          }
        });
      }
    };

    const handleDisconnect = () => {
      console.log('❌ MQTT disconnected');
      setIsConnected(false);
      addConnectionEvent('❌ Disconnected from MQTT broker');
    };

    const handleReconnect = () => {
      console.log('🔄 MQTT reconnecting...');
      addConnectionEvent('🔄 Attempting to reconnect...');
    };

    const handleOffline = () => {
      console.log('📴 MQTT offline');
      setIsConnected(false);
      addConnectionEvent('📴 Client went offline');
    };

    const handleMessage = (topic, message) => {
      const browserNow = Date.now();
      setMessageCount(prev => prev + 1);
      
      // Track messages per topic
      setTopicMessages(prev => ({
        ...prev,
        [topic]: (prev[topic] || 0) + 1
      }));
      
      // Log all incoming messages
      console.log('\n📨 Message received:');
      console.log('  Topic:', topic);
      console.log('  Decoder Mode:', decoderMode);
      console.log('  Message Length:', message.length, 'bytes');
      console.log('  Raw Message:', message.toString());
      
      setLastMessage({
        topic,
        time: new Date().toLocaleTimeString(),
        length: message.length,
        preview: message.toString().substring(0, 100)
      });

      if (topic in TOPIC_MAP) {
        try {
          const data = JSON.parse(message.toString());
          console.log('  Parsed JSON:', data);

          // Check if base64 mode and base64_sensordata exists
          if (decoderMode === 'base64' && data.base64_sensordata) {
            console.log('  🔍 Base64 mode - decoding base64_sensordata');
            console.log('  Base64 data length:', data.base64_sensordata.length);
            const decoded = decodePiezoData(data.base64_sensordata);
            if (decoded) {
              console.log('  ✅ Successfully decoded piezo data:', decoded);
              const mapping = TOPIC_MAP[topic];
              console.log('  Mapping:', mapping);
              console.log('  Number of decoded channels:', decoded.channels.length);
              
              setPiezo(prev => {
                const updated = { ...prev };
                const now = Date.now();
                
                // Map the 4 channels to the sensor keys
                for (let i = 0; i < Math.min(mapping.length, decoded.channels.length); i++) {
                  const mappedKey = mapping[i];
                  const oldArr = prev[mappedKey] || [];
                  const newPoints = decoded.channels[i].map(point => ({
                    time: point.timestamp,
                    value: point.value
                  }));
                  console.log(`  Mapping channel ${i} to ${mappedKey}: ${newPoints.length} new points, ${oldArr.length} old points`);
                  const combined = [...oldArr, ...newPoints].filter(d => now - d.time <= WINDOW_MS);
                  console.log(`  ${mappedKey} after filter: ${combined.length} points`);
                  updated[mappedKey] = combined;
                }
                
                return updated;
              });
            }
          } else {
            // Original decoder mode
            console.log('  🔍 Original mode - processing standard JSON format');
            // update offset running average if device timestamps exist
            for (let i = 0; i < 4; i++) {
              const d = data[`Sensor${i + 1}`];
              const sample = Array.isArray(d) ? d[0] : d;
              if (sample && typeof sample.ts === 'number') {
                const offsetSample = sample.ts - browserNow;
                offsetSamples.current.push(offsetSample);
                if (offsetSamples.current.length > OFFSET_SAMPLE_SIZE) {
                  offsetSamples.current.shift();
                }
                const avg = offsetSamples.current.reduce((a, b) => a + b, 0) / offsetSamples.current.length;
                offsetRef.current = avg;
                break;
              }
            }

            const mapping = TOPIC_MAP[topic];
            setPiezo(prev => {
              const updated = { ...prev };
              const offset = offsetRef.current;
              const now = Date.now();

              for (let i = 0; i < mapping.length; i++) {
                const mappedKey = mapping[i];
                const raw = data[`Sensor${i + 1}`];
                const oldArr = prev[mappedKey] || [];
                const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
                const newPoints = arr.map(obj => ({
                  time: typeof obj.ts === 'number' ? (obj.ts - offset) : now,
                  value: Number(obj.v) || 0
                }));
                const combined = [...oldArr, ...newPoints].filter(d => now - d.time <= WINDOW_MS);
                updated[mappedKey] = combined;
              }
              
              return updated;
            });
          }
        } catch (e) {
          console.error('Error parsing piezo message for', topic, e);
        }
      } else if (topic === 'iot/temp') {
        try {
          const data = JSON.parse(message.toString());
          console.log('  Parsed temp/hum JSON:', data);
          
          // Check if base64 mode and base64_sensordata exists
          if (decoderMode === 'base64' && data.base64_sensordata) {
            console.log('  🔍 Base64 mode - decoding temp/hum base64_sensordata');
            const decoded = decodeTempHumData(data.base64_sensordata);
            if (decoded) {
              console.log('  ✅ Successfully decoded temp/hum data:', decoded);
              setTemp1(decoded.temperature);
              setHum1(decoded.humidity);
            }
          } else {
            // Original decoder mode
            setTemp1(Number(data.Temperature) || 0);
            setHum1(Number(data.Humidity) || 0);
          }
        } catch (e) {
          console.error('Error parsing temp message for', topic, e);
        }
      }
    };

    client.on('connect', handleConnect);
    client.on('disconnect', handleDisconnect);
    client.on('reconnect', handleReconnect);
    client.on('offline', handleOffline);
    client.on('message', handleMessage);
    client.on('error', (error) => {
      console.error('❌ MQTT Error:', error);
      setIsConnected(false);
      addConnectionEvent(`❌ Error: ${error.message}`);
    });

    // Log initial state
    addConnectionEvent('🚀 Dashboard initialized');

    return () => {
      client.removeListener('connect', handleConnect);
      client.removeListener('disconnect', handleDisconnect);
      client.removeListener('reconnect', handleReconnect);
      client.removeListener('offline', handleOffline);
      client.removeListener('message', handleMessage);
    };
  }, [decoderMode]);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>IoT Sensor Dashboard</h1>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{
            padding: '8px 16px',
            borderRadius: '8px',
            backgroundColor: isConnected ? '#d4edda' : '#f8d7da',
            border: `2px solid ${isConnected ? '#28a745' : '#dc3545'}`,
            color: isConnected ? '#155724' : '#721c24',
            fontWeight: 'bold'
          }}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
          <div style={{
            padding: '8px 16px',
            borderRadius: '8px',
            backgroundColor: '#e7f3ff',
            border: '2px solid #0066cc',
            color: '#004085',
            fontWeight: 'bold'
          }}>
            📊 Messages: {messageCount}
          </div>
          <button 
          onClick={toggleDecoderMode}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            fontWeight: 'bold',
            borderRadius: '8px',
            border: '2px solid #007bff',
            backgroundColor: decoderMode === 'base64' ? '#007bff' : '#fff',
            color: decoderMode === 'base64' ? '#fff' : '#007bff',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          Decoder: {decoderMode === 'original' ? 'Original' : 'Base64'}
        </button>
        </div>
      </div>

      {/* Debug Info Panel */}
      {lastMessage && (
        <div style={{
          padding: '12px',
          marginBottom: '16px',
          backgroundColor: '#f8f9fa',
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '14px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>📩 Last Message:</div>
          <div><strong>Topic:</strong> {lastMessage.topic}</div>
          <div><strong>Time:</strong> {lastMessage.time}</div>
          <div><strong>Size:</strong> {lastMessage.length} bytes</div>
          <div><strong>Preview:</strong> {lastMessage.preview}{lastMessage.length > 100 ? '...' : ''}</div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            💡 Open browser console (F12) for detailed message logs
          </div>
        </div>
      )}

      {/* Connection Diagnostics Panel */}
      <div style={{
        padding: '12px',
        marginBottom: '16px',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        fontSize: '14px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>📊 Diagnostics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
          <div>
            <strong>Total Messages:</strong> {messageCount}
          </div>
          <div>
            <strong>Decoder Mode:</strong> {decoderMode}
          </div>
          <div>
            <strong>MQTT Status:</strong> {isConnected ? 'Connected ✅' : 'Disconnected ❌'}
          </div>
        </div>
        
        {Object.keys(topicMessages).length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <strong>Messages per Topic:</strong>
            <div style={{ marginTop: '4px', fontSize: '13px' }}>
              {Object.entries(topicMessages).map(([topic, count]) => (
                <div key={topic}>• {topic}: {count}</div>
              ))}
            </div>
          </div>
        )}
        
        {connectionEvents.length > 0 && (
          <div>
            <strong>Connection Events:</strong>
            <div style={{ marginTop: '4px', fontSize: '12px', maxHeight: '150px', overflowY: 'auto' }}>
              {connectionEvents.map((evt, idx) => (
                <div key={idx} style={{ padding: '2px 0' }}>
                  [{evt.time}] {evt.event}
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#856404', backgroundColor: '#fff', padding: '8px', borderRadius: '4px' }}>
          💡 <strong>Troubleshooting:</strong> If messages stop after 5:
          <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
            <li>Check if ESP32/device is still publishing</li>
            <li>Look for "reconnecting" events above</li>
            <li>Check browser console for connection errors</li>
            <li>Verify MQTT broker is accessible</li>
            <li>Check network connectivity/firewall</li>
          </ul>
        </div>
      </div>

      {/* 16 sensor plots in a 4×4 grid */}
      <div className="plots-grid">
        {SENSOR_KEYS.map((key) => (
          <SensorPlot key={key} title={key} data={piezo[key] || []} />
        ))}
      </div>

      {/* single-row gauges under plots */}
      <div className="gauges-grid" role="region" aria-label="Gauges">
        <div className="gauge-card">
          <h3>Temperature 1</h3>
          {/* hideLabel so we don't render the label again under the dial */}
          <Gauge value={temp1} label="Temperature 1" min={-40} max={60} hideLabel />
        </div>
        <div className="gauge-card">
          <h3>Humidity 1</h3>
          <Gauge value={hum1} label="Humidity 1" min={0} max={100} hideLabel />
        </div>
        <div className="gauge-card">
          <h3>Temperature 2</h3>
          <Gauge value={temp2} label="Temperature 2" min={-40} max={60} hideLabel />
        </div>
        <div className="gauge-card">
          <h3>Humidity 2</h3>
          <Gauge value={hum2} label="Humidity 2" min={0} max={100} hideLabel />
        </div>
      </div>
    </div>
  );
}

export default App;