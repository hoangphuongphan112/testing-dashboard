import mqtt from 'mqtt';

const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt'; // Make sure this matches your broker

const options = {
  clientId: 'sensor-dashboard-' + Math.random().toString(16).substr(2, 8),
  clean: true,
  reconnectPeriod: 2000, // Reconnect after 2 seconds if disconnected
  connectTimeout: 30 * 1000, // 30 seconds
  keepalive: 30, // Send ping every 30 seconds (more frequent)
  resubscribe: true, // Automatically resubscribe on reconnect
  protocolVersion: 4, // MQTT 3.1.1
  will: {
    topic: 'iot/status',
    payload: 'Dashboard disconnected',
    qos: 0,
    retain: false
  }
};

const client = mqtt.connect(brokerUrl, options);

// Add connection event listeners for debugging
client.on('connect', () => {
  console.log('🔗 MQTT Client connected to broker');
});

client.on('reconnect', () => {
  console.log('🔄 MQTT Client attempting to reconnect...');
});

client.on('close', () => {
  console.log('❌ MQTT Client connection closed');
});

client.on('offline', () => {
  console.log('📴 MQTT Client is offline');
});

client.on('error', (error) => {
  console.error('❌ MQTT Client error:', error);
});

export default client;