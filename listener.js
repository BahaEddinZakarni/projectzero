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

// FLOW: ESP32 -> Firebase (Status Updates)
client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    db.ref('meters/' + data.id).update({ 
        ...data, 
        lastSeen: Date.now() 
    });
    console.log(`Updated Meter: ${data.id}`);
  } catch (e) { console.error("Data Sync Error:", e); }
});

// --- 4. THE MISSING LINK: Firebase -> MQTT (Gear Box Commands) ---
// This watches the 'commands' folder in Firebase for changes
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key; // The ID of the meter you clicked
    
    let mqttPayload = "";
    
    // Map the Dashboard Gear Box actions to the ESP32 strings
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
