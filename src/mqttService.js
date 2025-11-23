import mqtt from 'mqtt';

const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt'; // Make sure this matches your broker

const options = {
  clientId: 'sensor-dashboard-' + Math.random().toString(16).substr(2, 8),
  clean: true,
  reconnectPeriod: 1000, // Reconnect after 1 second if disconnected
  connectTimeout: 30 * 1000, // 30 seconds
  keepalive: 60, // Send ping every 60 seconds
  resubscribe: true, // Automatically resubscribe on reconnect
  protocolVersion: 4, // MQTT 3.1.1
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