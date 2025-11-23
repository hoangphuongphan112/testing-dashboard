#!/usr/bin/env python3
"""
ESP32 Sensor Data Decoder for Python
Decodes binary-packed, Base64-encoded sensor data

Usage:
    python decoder.py                           # Serial mode (COM9 @ 115200)
    python decoder.py --interactive             # Interactive mode
    python decoder.py --file data.txt           # Decode from file
    python decoder.py --mqtt                    # Subscribe to MQTT
    python decoder.py --serial COM3 9600        # Custom serial port
    
Data Format:
- Piezo: 4 channels, batched samples, int16 values
- Temp/Hum: Single reading, int16 temperature, uint16 humidity
"""

import base64
import struct
import json
import sys
import argparse
from datetime import datetime

def decode_piezo_data(base64_data):
    """
    Decode Piezo sensor batch data
    Binary format (little-endian):
    - uint32_t base_timestamp (4 bytes) - seconds
    - uint16_t sample_interval_ms (2 bytes)
    - uint8_t num_samples (1 byte)
    - uint8_t num_channels (1 byte)
    - int16_t values[num_channels * num_samples] (2 bytes each)
    """
    # Decode Base64 to bytes
    binary_data = base64.b64decode(base64_data)
    
    # Read header (8 bytes total)
    base_timestamp, sample_interval_ms, num_samples, num_channels = struct.unpack(
        '<IHBB',  # '<' = little-endian, I=uint32, H=uint16, B=uint8, B=uint8
        binary_data[:8]
    )
    
    print(f"\n{'='*60}")
    print(f"[Piezo] Batch Info:")
    print(f"  Base Timestamp: {base_timestamp} ({datetime.fromtimestamp(base_timestamp).isoformat()})")
    print(f"  Sample Interval: {sample_interval_ms}ms")
    print(f"  Samples per Channel: {num_samples}")
    print(f"  Channels: {num_channels}")
    print(f"  Binary Size: {len(binary_data)} bytes")
    
    # Read sensor values (2 bytes per value, signed int16)
    values = []
    offset = 8
    
    for ch in range(num_channels):
        channel_data = []
        for s in range(num_samples):
            raw_value = struct.unpack('<h', binary_data[offset:offset+2])[0]  # signed int16
            voltage_mv = raw_value / 100.0  # Convert from centimV to mV
            timestamp_ms = base_timestamp * 1000 + (s * sample_interval_ms)
            
            # Filter out invalid sentinel value (-32768 = 0x8000)
            if raw_value == -32768:
                voltage_mv = None  # Mark as invalid
            
            channel_data.append({
                'sample': s,
                'timestamp_ms': timestamp_ms,
                'value_mV': round(voltage_mv, 2) if voltage_mv is not None else 'INVALID'
            })
            offset += 2
        
        values.append({
            'channel': ch + 1,
            'data': channel_data
        })
    
    # Print summary (skip invalid values)
    for ch in values:
        valid_samples = [s for s in ch['data'] if s['value_mV'] != 'INVALID']
        if valid_samples:
            first = valid_samples[0]
            last = valid_samples[-1]
            print(f"  Channel {ch['channel']}: {first['value_mV']}mV -> {last['value_mV']}mV ({len(valid_samples)}/{len(ch['data'])} valid samples)")
        else:
            print(f"  Channel {ch['channel']}: No valid samples")
    
    return {
        'type': 'piezo',
        'base_timestamp': base_timestamp,
        'sample_interval_ms': sample_interval_ms,
        'num_samples': num_samples,
        'num_channels': num_channels,
        'channels': values
    }

def decode_temphum_data(base64_data):
    """
    Decode Temperature/Humidity data
    Binary format (little-endian):
    - uint32_t timestamp (4 bytes) - seconds
    - int16_t temperature (2 bytes) - temp * 100
    - uint16_t humidity (2 bytes) - humidity * 100
    Total: 8 bytes
    """
    # Decode Base64 to bytes
    binary_data = base64.b64decode(base64_data)
    
    # Read fields
    timestamp, temp_raw, hum_raw = struct.unpack('<IhH', binary_data)
    
    temperature = temp_raw / 100.0
    humidity = hum_raw / 100.0
    
    print(f"\n{'='*60}")
    print(f"[TempHum] Reading:")
    print(f"  Timestamp: {timestamp} ({datetime.fromtimestamp(timestamp).isoformat()})")
    print(f"  Temperature: {temperature:.2f}°C")
    print(f"  Humidity: {humidity:.2f}%")
    print(f"  Binary Size: {len(binary_data)} bytes")
    
    return {
        'type': 'temp_hum',
        'timestamp': timestamp,
        'temperature': temperature,
        'humidity': humidity
    }

def process_json_message(json_str):
    """
    Process JSON message from ESP32
    Expected format: {"ts": ..., "time_interval": ..., "base64_sensordata": "..."}
    """
    try:
        data = json.loads(json_str)
        
        print(f"\nJSON Message:")
        print(f"  Timestamp: {data.get('ts')}")
        print(f"  Time Interval: {data.get('time_interval')}ms")
        
        base64_data = data.get('base64_sensordata', '')
        
        # Try to determine type based on size
        binary_size = len(base64.b64decode(base64_data))
        
        if binary_size == 8:
            # Temperature/Humidity data
            return decode_temphum_data(base64_data)
        else:
            # Piezo data
            return decode_piezo_data(base64_data)
            
    except Exception as e:
        print(f"Error decoding message: {e}")
        print(f"Raw data: {json_str}")
        return None

def interactive_mode():
    """Interactive mode - paste JSON data"""
    print("ESP32 Sensor Data Decoder - Interactive Mode")
    print("=" * 60)
    print("Paste JSON data (or 'quit' to exit):\n")
    
    while True:
        try:
            line = input("> ").strip()
            if line.lower() in ['quit', 'exit', 'q']:
                break
            if not line:
                continue
                
            # Check if it's a JSON line from serial output
            if '[Piezo] JSON:' in line or '[TempHum] JSON:' in line:
                # Extract JSON part
                json_part = line.split('JSON:', 1)[1].strip()
                process_json_message(json_part)
            else:
                # Try to process as JSON directly
                process_json_message(line)
                
        except KeyboardInterrupt:
            print("\nExiting...")
            break
        except Exception as e:
            print(f"Error: {e}")

def file_mode(filename):
    """Read and decode data from file"""
    print(f"ESP32 Sensor Data Decoder - File Mode")
    print(f"Reading from: {filename}")
    print("=" * 60)
    
    try:
        with open(filename, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                    
                # Check if it's a JSON line from serial output
                if '[Piezo] JSON:' in line or '[TempHum] JSON:' in line:
                    json_part = line.split('JSON:', 1)[1].strip()
                    process_json_message(json_part)
                elif line.startswith('{'):
                    process_json_message(line)
                    
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found")
    except Exception as e:
        print(f"Error reading file: {e}")

def mqtt_mode():
    """Subscribe to MQTT broker and decode messages"""
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("Error: paho-mqtt library not installed")
        print("Install with: pip install paho-mqtt")
        return
    
    BROKER = "broker.hivemq.com"
    PORT = 1883
    PIEZO_TOPIC = "iot/piezo"
    TEMP_TOPIC = "iot/temp"
    
    print(f"ESP32 Sensor Data Decoder - MQTT Mode")
    print(f"Connecting to {BROKER}:{PORT}")
    print("=" * 60)
    
    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            print(f"✓ Connected to MQTT broker")
            client.subscribe([(PIEZO_TOPIC, 0), (TEMP_TOPIC, 0)])
            print(f"✓ Subscribed to: {PIEZO_TOPIC}, {TEMP_TOPIC}")
            print("\nWaiting for messages...\n")
        else:
            print(f"✗ Connection failed with code {rc}")
    
    def on_message(client, userdata, msg):
        print(f"\n{'='*60}")
        print(f"Topic: {msg.topic}")
        process_json_message(msg.payload.decode())
    
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    
    try:
        client.connect(BROKER, PORT, 60)
        client.loop_forever()
    except KeyboardInterrupt:
        print("\nDisconnecting...")
        client.disconnect()
    except Exception as e:
        print(f"MQTT Error: {e}")

def serial_mode(port='COM9', baudrate=115200):
    """Read from serial port and decode messages in real-time"""
    try:
        import serial
    except ImportError:
        print("Error: pyserial library not installed")
        print("Install with: pip install pyserial")
        return
    
    print(f"ESP32 Sensor Data Decoder - Serial Mode")
    print(f"Connecting to {port} @ {baudrate} baud")
    print("=" * 60)
    
    try:
        ser = serial.Serial(port, baudrate, timeout=1)
        print(f"✓ Connected to {port}")
        print("Waiting for data...\n")
        
        while True:
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                if not line:
                    continue
                
                # Look for JSON data in serial output
                if '[Piezo] JSON:' in line or '[TempHum] JSON:' in line:
                    # Extract JSON part
                    json_part = line.split('JSON:', 1)[1].strip()
                    process_json_message(json_part)
                elif line.startswith('{') and 'base64_sensordata' in line:
                    # Direct JSON line
                    process_json_message(line)
                else:
                    # Print other serial output for debugging
                    if any(keyword in line for keyword in ['[Modem]', '[TimeSync]', '[Setup]', '[Core', '[Piezo]', '[TempHum]']):
                        print(line)
                        
            except KeyboardInterrupt:
                print("\nClosing serial port...")
                break
            except Exception as e:
                print(f"Error reading line: {e}")
                
        ser.close()
        print("Disconnected")
        
    except serial.SerialException as e:
        print(f"Serial Error: {e}")
        print(f"Make sure {port} is available and not in use by another program")
    except Exception as e:
        print(f"Error: {e}")

def main():
    parser = argparse.ArgumentParser(
        description='ESP32 Sensor Data Decoder',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python decoder.py                          # Serial mode (COM9 @ 115200)
  python decoder.py --serial COM3 9600       # Custom serial port
  python decoder.py --interactive            # Interactive mode
  python decoder.py --file data.txt          # Decode from file
  python decoder.py --mqtt                   # Subscribe to MQTT
        """
    )
    
    parser.add_argument('--serial', '-s', nargs=2, metavar=('PORT', 'BAUD'), 
                        help='Serial port and baudrate (default: COM9 115200)')
    parser.add_argument('--interactive', '-i', action='store_true', 
                        help='Interactive mode (paste JSON)')
    parser.add_argument('--file', '-f', help='Read data from file')
    parser.add_argument('--mqtt', '-m', action='store_true', 
                        help='Subscribe to MQTT broker')
    
    args = parser.parse_args()
    
    if args.mqtt:
        mqtt_mode()
    elif args.file:
        file_mode(args.file)
    elif args.interactive:
        interactive_mode()
    elif args.serial:
        port, baud = args.serial
        serial_mode(port, int(baud))
    else:
        # Default: Serial mode with COM9 @ 115200
        serial_mode('COM9', 115200)

if __name__ == '__main__':
    main()
