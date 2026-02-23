const mqtt = require('mqtt');
const admin = require('firebase-admin');
const http = require('http');

// --- 1. THE DUMMY SERVER (Keeps Render happy) ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Cloud Listener is running!");
});
server.listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log("Web server active on port", process.env.PORT || 10000);
});

// --- 2. FIREBASE INITIALIZATION ---
// Uses the Environment Variables you set in Render
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

// FLOW: ESP32 -> Firebase (Now using hardware-detected revenue)
client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    // A. REVENUE: If the ESP32 detected a coin, it sends a 'pay' value (1, 2, 5, or 10)
    if (data.pay && data.pay > 0) {
        await db.ref('global_stats/totalRevenue').transaction((current) => {
            return (current || 0) + data.pay;
        });
        console.log(`💰 Verified Payment from ${macId}: +$${data.pay}`);
    }

    // B. STATUS: Update the meter info (remA, locA, remB, locB)
    await db.ref('meters/' + macId).update({ 
        remA: data.remA,
        locA: data.locA,
        remB: data.remB,
        locB: data.locB,
        lastSeen: Date.now() 
    });
    
  } catch (e) { console.error("Data Processing Error:", e); }
});

// --- 4. COMMAND LOGIC (Dashboard -> Firebase -> MQTT) ---
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key;
    let mqttPayload = "";

    // Map Dashboard actions to the ESP32 command strings
    if (cmd.action === "RESET") {
        mqttPayload = "reset" + cmd.slot;
    } else if (cmd.action === "LOCK") {
        mqttPayload = "forceLoc" + cmd.slot;
    } else if (cmd.action === "ADD_TIME") {
        mqttPayload = `add:${cmd.value}${cmd.slot}`;
    }

    if (mqttPayload) {
        const topic = `city/street1/${macId}/cmd`;
        client.publish(topic, mqttPayload);
        console.log(`🚀 Command Sent to ${macId}: ${mqttPayload}`);
    }
});
