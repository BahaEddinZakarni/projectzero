const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http');

// --- 1. THE DUMMY SERVER ---
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

// --- 3. MQTT LOGIC ---
const client = mqtt.connect("wss://c335c915f7a540bcb9d83b6f4b0444f3.s1.eu.hivemq.cloud:8884/mqtt", {
  username: 'esp32_worker',
  password: 'ParkMaster2026'
});

client.on('connect', () => {
  console.log("✅ MQTT Connected & Listening...");
  client.subscribe('city/street1/+/status');
});

// FLOW: ESP32 -> Firebase (With Revenue Fix)
client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    // Get old data once to check for revenue jumps
    const snapshot = await db.ref('meters/' + macId).once('value');
    const oldData = snapshot.val() || { remA: 0, remB: 0 };
    
    let addedRevenue = 0;
    const SEC_PER_DOLLAR = 1800; // Adjust based on your rate

    // Calculate Slot A jump
    if (data.remA > oldData.remA) {
        let jump = data.remA - oldData.remA;
        if (jump > 10) addedRevenue += (jump / SEC_PER_DOLLAR);
    }
    // Calculate Slot B jump
    if (data.remB > oldData.remB) {
        let jump = data.remB - oldData.remB;
        if (jump > 10) addedRevenue += (jump / SEC_PER_DOLLAR);
    }

    // Update Global Revenue if money was added
    if (addedRevenue > 0) {
        await db.ref('global_stats/totalRevenue').transaction((current) => {
            return (current || 0) + addedRevenue;
        });
        console.log(`💰 Revenue Added: $${addedRevenue.toFixed(2)}`);
    }

    // Update Meter Status
    await db.ref('meters/' + macId).update({ 
        ...data, 
        lastSeen: Date.now() 
    });
    
  } catch (e) { console.error("Sync Error:", e); }
});

// --- 4. COMMAND LOGIC (Dashboard -> ESP32) ---
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key;
    let mqttPayload = "";

    if (cmd.action === "RESET") mqttPayload = "reset" + cmd.slot;
    else if (cmd.action === "LOCK") mqttPayload = "forceLoc" + cmd.slot;
    else if (cmd.action === "ADD_TIME") mqttPayload = `add:${cmd.value}${cmd.slot}`;

    if (mqttPayload) {
        client.publish(`city/street1/${macId}/cmd`, mqttPayload);
        console.log(`🚀 Sent to ${macId}: ${mqttPayload}`);
    }
});
