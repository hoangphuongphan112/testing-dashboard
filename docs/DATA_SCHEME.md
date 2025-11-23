# ESP32 Sensor Data Encoding Scheme

Complete specification for the binary data encoding used by the ESP32 water quality monitoring system.

## Overview

The system uses **binary-packed + Base64 encoding** to minimize bandwidth usage over LTE networks, achieving **~95% data reduction** compared to raw JSON.

**Data Flow:**
```
Sensors → Binary Packing → Base64 Encoding → JSON Envelope → MQTT → Decoder
```

## JSON Envelope

All sensor data is wrapped in a simple JSON structure:

```json
{
  "ts": 1732012345678,
  "time_interval": 100,
  "base64_sensordata": "xlocaXgAFAQAgCb/Pf+AAg..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ts` | uint64 | Timestamp in milliseconds (first sample) |
| `time_interval` | uint16 | Sampling interval in milliseconds (0 for single readings) |
| `base64_sensordata` | string | Base64-encoded binary sensor data |

---

## Piezo Sensor Data Format

### Binary Structure

**Header (8 bytes):**

```c
struct __attribute__((packed)) PiezoBatchData {
  uint32_t base_timestamp;      // Base timestamp (seconds since epoch)
  uint16_t sample_interval_ms;  // Interval between samples (ms)
  uint8_t  num_samples;         // Number of samples per channel
  uint8_t  num_channels;        // Number of channels (always 4)
};
```

**Data Section (variable length):**

```c
int16_t values[num_samples * num_channels];  // 2 bytes per value
```

Values are stored **interleaved by sample** (not by channel):
```
[s0_ch1, s0_ch2, s0_ch3, s0_ch4, s1_ch1, s1_ch2, s1_ch3, s1_ch4, ...]
```

### Data Layout

| Offset | Size | Type | Field | Description |
|--------|------|------|-------|-------------|
| 0 | 4 bytes | uint32_t | base_timestamp | Unix timestamp (seconds) |
| 4 | 2 bytes | uint16_t | sample_interval_ms | Time between samples |
| 6 | 1 byte | uint8_t | num_samples | Samples per channel |
| 7 | 1 byte | uint8_t | num_channels | Channel count (4) |
| 8+ | 2n bytes | int16_t[] | values | Voltage values (n = samples × channels) |

### Value Encoding

- **Raw Sensor Value:** Voltage in millivolts (mV)
- **Encoding:** `int16_t = voltage_mV × 100`
- **Range:** -327.68 mV to +327.67 mV
- **Precision:** 0.01 mV (centimillivolt)
- **Byte Order:** Little-endian

**Special Values:**
- `0x8000` (-32768): Invalid/uninitialized sample (should be filtered)

### Example

**Configuration:**
- 20 samples per channel
- 4 channels
- 100ms sampling interval

**Binary Size:**
```
Header:  8 bytes
Data:    20 samples × 4 channels × 2 bytes = 160 bytes
Total:   168 bytes
Base64:  ~224 characters
JSON:    ~260 bytes
```

**Decoding (Python):**
```python
import struct
import base64

# Decode Base64
binary_data = base64.b64decode(base64_string)

# Read header
base_ts, interval_ms, num_samples, num_channels = struct.unpack('<IHBB', binary_data[:8])

# Read values (interleaved by sample)
offset = 8
for sample in range(num_samples):
    for channel in range(num_channels):
        raw_value = struct.unpack('<h', binary_data[offset:offset+2])[0]
        voltage_mv = raw_value / 100.0
        offset += 2
```

---

## Temperature/Humidity Data Format

### Binary Structure

```c
struct __attribute__((packed)) TempHumData {
  uint32_t timestamp;     // Unix timestamp (seconds)
  int16_t  temperature;   // Temperature × 100 (°C)
  uint16_t humidity;      // Humidity × 100 (%)
};
```

**Total Size:** 8 bytes → ~12 bytes Base64 → ~75 bytes JSON

### Data Layout

| Offset | Size | Type | Field | Description |
|--------|------|------|-------|-------------|
| 0 | 4 bytes | uint32_t | timestamp | Unix timestamp (seconds) |
| 4 | 2 bytes | int16_t | temperature | Temp × 100 (signed) |
| 6 | 2 bytes | uint16_t | humidity | Humidity × 100 (unsigned) |

### Value Encoding

**Temperature:**
- **Encoding:** `int16_t = temperature_°C × 100`
- **Range:** -327.68°C to +327.67°C
- **Precision:** 0.01°C
- **Signed:** Yes

**Humidity:**
- **Encoding:** `uint16_t = humidity_% × 100`
- **Range:** 0% to 655.35%
- **Precision:** 0.01%
- **Signed:** No

### Example

**Input:**
- Temperature: 23.45°C
- Humidity: 67.89%
- Timestamp: 1732012345 (seconds)

**Encoding:**
```c
temperature = (int16_t)(23.45 × 100) = 2345 = 0x0929
humidity = (uint16_t)(67.89 × 100) = 6789 = 0x1A85
```

**Binary (hex):**
```
59 9A 46 67  29 09  85 1A
└─timestamp─┘ └temp┘ └hum┘
```

**Decoding (Python):**
```python
import struct
import base64

binary_data = base64.b64decode(base64_string)
timestamp, temp_raw, hum_raw = struct.unpack('<IhH', binary_data)

temperature = temp_raw / 100.0  # °C
humidity = hum_raw / 100.0      # %
```

---

## Byte Order (Endianness)

**All multi-byte values use Little-Endian encoding** (ESP32 default).

Example: `0x12345678` is stored as:
```
[0x78, 0x56, 0x34, 0x12]
 LSB              MSB
```

---

## MQTT Topics

| Topic | Data Type | Update Rate |
|-------|-----------|-------------|
| `iot/piezo` | Piezo batch | Every 2-4 seconds (configurable) |
| `iot/temp` | Temp/Humidity | Every 1 second |

---

## Size Comparison

### Piezo Batch (20 samples × 4 channels)

| Format | Size | Reduction |
|--------|------|-----------|
| **Raw JSON** (nested arrays) | ~4,096 bytes | — |
| **Binary Packed** | 168 bytes | 95.9% |
| **Base64 Encoded** | 224 bytes | 94.5% |
| **JSON Envelope** | 260 bytes | 93.7% |

### Temperature/Humidity (single reading)

| Format | Size | Reduction |
|--------|------|-----------|
| **Raw JSON** | ~70 bytes | — |
| **Binary Packed** | 8 bytes | 88.6% |
| **Base64 Encoded** | 12 bytes | 82.9% |
| **JSON Envelope** | 78 bytes | -11.4% |

**Note:** For small single readings, the JSON envelope overhead reduces efficiency. However, bandwidth savings are maximized for batched piezo data, which is the dominant data source.

---

## Implementation Notes

### ESP32 (Encoding)

**Files:**
- `DataSerialization.h/cpp` - Binary packing functions
- `Tasks.cpp` - Inline encoding in sampling tasks

**Key Functions:**
```cpp
size_t serializePiezoBatch(float* buffers[4], uint64_t* timestamps[4], 
                           int numSamples, uint8_t* output, size_t outputSize);

size_t serializeTempHum(float temp, float hum, uint64_t timestamp, 
                        uint8_t* output);
```

### Decoder (Python/Node.js)

**Python:** `decoder.py`
```python
struct.unpack('<IHBB', data[:8])  # Piezo header
struct.unpack('<IhH', data)       # Temp/Hum
```

**Node.js:** `decoder-example.js`
```javascript
buffer.readUInt32LE(0)   // Piezo header
buffer.readInt16LE(4)    // Temperature
buffer.readUInt16LE(6)   // Humidity
```

---

## Error Handling

### Invalid Values

- **Piezo:** `0x8000` (-32768) indicates invalid/uninitialized sample
- **Filter:** Decoders should skip samples with value `-327.68mV`
- **Display:** Show valid sample count: `"18/20 valid samples"`

### Buffer Overflow

- ESP32 enforces maximum buffer sizes
- Exceeded size triggers error: `"[Serialization] Buffer too small"`

### Timestamp Overflow

- Timestamps stored as `uint32_t` (seconds) for compactness
- **Overflow:** Year 2106 (4,294,967,295 seconds since epoch)
- **Mitigation:** Use full `uint64_t` in JSON envelope

---

## Configuration Parameters

From `Config.h`:

```cpp
#define SAMPLE_INTERVAL_MS 100    // Piezo sampling interval
#define SAMPLES_PER_BATCH 10      // Samples per channel per batch
#define ENV_INTERVAL_MS 1000      // Temp/Hum sampling interval
#define SENSITIVITY_GAIN 10.0     // Piezo voltage scaling factor
```

**Adjustable Trade-offs:**
- ↑ `SAMPLES_PER_BATCH` = Less frequent transmissions, better compression
- ↓ `SAMPLE_INTERVAL_MS` = Higher sampling rate, more data
- Typical: 10-20 samples at 100-200ms intervals

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11 | Initial binary encoding scheme |

---

## References

- **ESP32 Source:** `ESP32_Piezo_Tem_Hum_Bipolar_Walter/`
- **Python Decoder:** `docs/decoder.py`
- **Node.js Decoder:** `docs/decoder-example.js`
- **Documentation:** `docs/PYTHON_DECODER.md`, `docs/DECODER_README.md`
