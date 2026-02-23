const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http');

// --- 1. THE DUMMY SERVER (Enhanced to stay awake) ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Cloud Listener is running!");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Web server active on port ${PORT}`);
});

// SELF-PING LOGIC: Prevents Render from sleeping
setInterval(() => {
  http.get(`http://localhost:${PORT}`);
}, 10 * 60 * 1000); // Pings itself every 10 minutes

// --- 2. FIREBASE INITIALIZATION ---
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// --- 3. MQTT LOGIC (With Reconnect & Keep-Alive) ---
const mqttOptions = {
  username: 'esp32_worker',
  password: 'ParkMaster2026',
  keepalive: 60,         // Ping broker every 60s
  reconnectPeriod: 1000, // Wait 1s before reconnecting
  connectTimeout: 30 * 1000,
  clean: true
};

const client = mqtt.connect("wss://c335c915f7a540bcb9d83b6f4b0444f3.s1.eu.hivemq.cloud:8884/mqtt", mqttOptions);

client.on('connect', () => {
  console.log("✅ Bridge connected to HiveMQ!");
  client.subscribe('city/street1/+/status');
});

client.on('error', (err) => {
  console.error("❌ MQTT Error:", err);
  // No need to manually reconnect, the library does it based on mqttOptions
});

client.on('offline', () => {
  console.warn("⚠️ Bridge is OFFLINE. Attempting to reconnect...");
});

// FLOW: ESP32 -> Firebase
client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    if (data.pay && data.pay > 0) {
        await db.ref('global_stats/totalRevenue').transaction((current) => {
            return (current || 0) + data.pay;
        });
        console.log(`💰 Verified Payment from ${macId}: +$${data.pay}`);
    }

    await db.ref('meters/' + macId).update({ 
        remA: data.remA,
        locA: data.locA,
        remB: data.remB,
        locB: data.locB,
        lastSeen: Date.now() 
    });
    
  } catch (e) { console.error("Data Processing Error:", e); }
});

// --- 4. COMMAND LOGIC ---
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key;
    let mqttPayload = "";

    if (cmd.action === "RESET") mqttPayload = "reset" + cmd.slot;
    else if (cmd.action === "LOCK") mqttPayload = "forceLoc" + cmd.slot;
    else if (cmd.action === "ADD_TIME") mqttPayload = `add:${cmd.value}${cmd.slot}`;

    if (mqttPayload && client.connected) {
        client.publish(`city/street1/${macId}/cmd`, mqttPayload);
        console.log(`🚀 Command Sent to ${macId}: ${mqttPayload}`);
    } else {
        console.warn("⚠️ Command failed: MQTT not connected.");
    }
});
