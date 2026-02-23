const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http'); // Add this for the dummy server

// --- 1. THE DUMMY SERVER (To stay free on Render) ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Cloud Listener is running!");
});
server.listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log("Web server active on port", process.env.PORT || 10000);
});

// --- 2. FIREBASE INITIALIZATION ---
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// --- 3. MQTT LOGIC (Same as before) ---
const client = mqtt.connect("wss://c335c915f7a540bcb9d83b6f4b0444f3.s1.eu.hivemq.cloud:8884/mqtt", {
  username: 'esp32_worker',
  password: 'ParkMaster2026'
});

client.on('connect', () => {
  console.log("✅ MQTT Connected & Listening...");
  client.subscribe('city/street1/+/status');
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    db.ref('meters/' + data.id).set({ ...data, lastSeen: Date.now() });
    console.log(`Updated Meter: ${data.id}`);
  } catch (e) { console.error("Error:", e); }
});
