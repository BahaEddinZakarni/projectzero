const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http');

// --- 1. THE DUMMY SERVER (Keeps Render Awake) ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bridge is ACTIVE");
});
server.listen(PORT, '0.0.0.0');

// --- 2. FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// --- 3. MQTT SETTINGS (The "Anti-Ghosting" Config) ---
const mqttOptions = {
  username: 'esp32_worker',
  password: 'ParkMaster2026',
  keepalive: 10,           // Very frequent pings (every 10s)
  reconnectPeriod: 2000,   // Rapid reconnect
  connectTimeout: 30000,
  clean: true,             // Wipe old session data to prevent ghosting
  clientId: 'bridge_' + Math.random().toString(16).substring(2, 10) // Always unique
};

const client = mqtt.connect("wss://c335c915f7a540bcb9d83b6f4b0444f3.s1.eu.hivemq.cloud:8884/mqtt", mqttOptions);

client.on('connect', () => {
  console.log("✅ Connected to HiveMQ");
  client.subscribe('city/street1/+/status');
});

// If the bridge stays silent too long, Render might throttle it.
// This sends a tiny "nothing" message to HiveMQ to keep the pipe open.
setInterval(() => {
  if (client.connected) {
    client.publish('bridge/heartbeat', 'stay_alive');
  }
}, 30000); 

client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    // Revenue Update
    if (data.pay && data.pay > 0) {
        await db.ref('global_stats/totalRevenue').transaction(c => (c || 0) + data.pay);
    }

    // Status Update
    await db.ref('meters/' + macId).update({ 
        remA: data.remA, locA: data.locA,
        remB: data.remB, locB: data.locB,
        lastSeen: Date.now() 
    });
  } catch (e) { console.error("Error:", e); }
});

// --- 4. COMMAND LOGIC ---
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key;
    let payload = "";
    if (cmd.action === "RESET") payload = "reset" + cmd.slot;
    else if (cmd.action === "LOCK") payload = "forceLoc" + cmd.slot;
    else if (cmd.action === "ADD_TIME") payload = `add:${cmd.value}${cmd.slot}`;

    if (payload && client.connected) {
        client.publish(`city/street1/${macId}/cmd`, payload);
    }
});
