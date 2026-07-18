const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Setup
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, default: 'global' },
  isLocked: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

const Device = mongoose.model('Device', DeviceSchema);

// API Endpoints for Android App
app.get('/device/status', async (req, res) => {
  try {
    let device = await Device.findOne({ deviceId: 'global' });
    if (!device) {
      device = await Device.create({ deviceId: 'global', isLocked: false });
    }
    device.lastSeen = new Date();
    await device.save();
    res.json({ isLocked: device.isLocked });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin API to toggle lock
app.post('/admin/lock', async (req, res) => {
  const { lock } = req.body;
  try {
    await Device.findOneAndUpdate({ deviceId: 'global' }, { isLocked: lock });
    res.json({ success: true, isLocked: lock });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Simple Admin UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>KAVACH Admin Control</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 50px; }
        .btn { padding: 20px 40px; font-size: 20px; cursor: pointer; margin: 20px; color: white; border: none; border-radius: 8px; }
        .lock { background-color: #f44336; }
        .unlock { background-color: #4CAF50; }
        .status { font-weight: bold; font-size: 24px; }
      </style>
    </head>
    <body>
      <h1>KAVACH Enterprise Control</h1>
      <p>Current Status: <span id="status" class="status">Loading...</span></p>
      <button class="btn lock" onclick="updateLock(true)">Force LOCK Device</button>
      <button class="btn unlock" onclick="updateLock(false)">Force FREE Device</button>
      <hr>
      <p>Download APK: <a href="/apk/app-debug.apk">app-debug.apk</a></p>

      <script>
        async function getStatus() {
          const res = await fetch('/device/status');
          const data = await res.json();
          document.getElementById('status').innerText = data.isLocked ? 'LOCKED' : 'FREE';
          document.getElementById('status').style.color = data.isLocked ? 'red' : 'green';
        }

        async function updateLock(lock) {
          await fetch('/admin/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lock })
          });
          getStatus();
        }

        setInterval(getStatus, 5000);
        getStatus();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
