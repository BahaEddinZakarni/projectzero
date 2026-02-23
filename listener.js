client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const macId = data.id;

    // --- IMPROVED REVENUE CALCULATION ---
    db.ref('meters/' + macId).once('value').then((snapshot) => {
      const oldData = snapshot.val() || { remA: 0, remB: 0 };
      let revenueGain = 0;
      const COIN_VAL = 0.25; // Change this to your actual coin value
      const SEC_PER_COIN = 900; // Change this (e.g., 900s for 0.25c)

      // Check Slot A: If it jumps from 0 to something, OR jumps up while running
      if (data.remA > oldData.remA) {
          // Calculate how many seconds were added
          let addedSecs = data.remA - oldData.remA;
          // Only count it if it's a significant jump (ignore small sync drifts)
          if (addedSecs > 10) { 
              revenueGain += (addedSecs / SEC_PER_COIN) * COIN_VAL;
          }
      }

      // Check Slot B
      if (data.remB > oldData.remB) {
          let addedSecs = data.remB - oldData.remB;
          if (addedSecs > 10) {
              revenueGain += (addedSecs / SEC_PER_COIN) * COIN_VAL;
          }
      }

      // If we made money, update the global total
      if (revenueGain > 0) {
        db.ref('global_stats/totalRevenue').transaction((current) => {
          return (current || 0) + revenueGain;
        });
        console.log(`💰 Revenue Added: $${revenueGain.toFixed(2)}`);
      }

      // Finally, update the meter status as usual
      db.ref('meters/' + macId).update({
        ...data,
        lastSeen: Date.now()
      });
    });

  } catch (e) { console.error("Revenue Logic Error:", e); }
});
