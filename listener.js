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

// FLOW: ESP32 -> Firebase (With Whole Dollar Revenue Fix)
client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    // Get the previous state from Firebase
    const snapshot = await db.ref('meters/' + macId).once('value');
    const oldData = snapshot.val() || { remA: 0, remB: 0 };
    
    let totalAddedThisCycle = 0;

    // HELPER: Detects specific payment jumps only (1, 2, 5, 10)
    const getPaymentValue = (newTime, oldTime) => {
        let jump = newTime - oldTime;
        
        // Match jumps to your payment tiers (assuming 1800s per $1)
        if (jump >= 1700 && jump <= 1900) return 1;   // $1 jump
        if (jump >= 3500 && jump <= 3700) return 2;   // $2 jump
        if (jump >= 8900 && jump <= 9100) return 5;   // $5 jump
        if (jump >= 17900 && jump <= 18100) return 10; // $10 jump

        return 0; // Ignore decimals, noise, or grace periods
    };

    // Check both slots for whole dollar payments
    totalAddedThisCycle += getPaymentValue(data.remA, oldData.remA);
    totalAddedThisCycle += getPaymentValue(data.remB, oldData.remB);

    // Update Global Revenue if a whole dollar payment was detected
    if (totalAddedThisCycle > 0) {
        await db.ref('global_stats/totalRevenue').transaction((current) => {
            return (current || 0) + totalAddedThisCycle;
        });
        console.log(`💰 Payment Verified: +$${totalAddedThisCycle}`);
    }

    // Update the meter status (including lastSeen for connection status)
    await db.ref('meters/' + macId).update({ 
        ...data, 
        lastSeen: Date.now() 
    });
    
  } catch (e) { console.error("Sync Error:", e); }
});

// --- 4. COMMAND LOGIC (Firebase -> MQTT) ---
db.ref('commands').on('child_changed', (snapshot) => {
    const cmd = snapshot.val();
    const macId = snapshot.key;
    let mqttPayload = "";

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
