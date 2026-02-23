const mqtt = require('mqtt');
const admin = require('firebase-admin');

// 1. Initialize Firebase using Environment Variables (for security)
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.database();

// 2. Connect to HiveMQ
const client = mqtt.connect("wss://c335c915f7a540bcb9d83b6f4b0444f3.s1.eu.hivemq.cloud:8884/mqtt", {
  username: 'esp32_worker',
  password: 'ParkMaster2026'
});

client.on('connect', () => {
  console.log("✅ Cloud Listener is ONLINE");
  client.subscribe('city/street1/+/status');
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const id = data.id;

    // Save to Firebase - This happens 24/7!
    db.ref('meters/' + id).set({
      ...data,
      lastSeen: Date.now()
    });

    console.log(`Updated Meter: ${id}`);
  } catch (e) {
    console.error("Error processing message:", e);
  }
});
