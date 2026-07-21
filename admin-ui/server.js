const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Mock Database (In-memory)
let devices = [
  {
    deviceId: "device_001",
    name: "Test User",
    status: "UNLOCKED",
    lockReason: null,
    lastSeen: new Date().toISOString()
  }
];

// --- ADMIN ENDPOINTS ---

// Get all devices
app.get('/admin/devices', (req, res) => {
  res.json(devices);
});

// Update device status (LOCK/UNLOCK)
app.post('/admin/update-status/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { status, reason } = req.body;

  const device = devices.find(d => d.deviceId === deviceId);
  if (device) {
    device.status = status;
    device.lockReason = reason || null;
    res.json({ success: true, device });
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

// Generate Provisioning QR
app.get('/admin/generate-qr', async (req, res) => {
  const provisioningData = {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.example.expo_lock/com.example.expo_lock.admin.KavachDeviceAdminReceiver",
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": `http://${req.hostname}:${port}/app-debug.apk`,
    "android.app.extra.PROVISIONING_MODE": 1,
    "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
      "registration_token": "mock_token_" + Date.now(),
      "server_url": `http://${req.hostname}:${port}`
    }
  };

  try {
    const qrImage = await QRCode.toDataURL(JSON.stringify(provisioningData));
    res.json({ qrImage, provisioningData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// --- DEVICE ENDPOINTS ---

// Register device
app.post('/device/register', (req, res) => {
  const { deviceId, name } = req.body;
  const existing = devices.find(d => d.deviceId === deviceId);
  if (!existing) {
    devices.push({
      deviceId,
      name: name || "Unknown Device",
      status: "UNLOCKED",
      lockReason: null,
      lastSeen: new Date().toISOString()
    });
  }
  res.json({ success: true });
});

// Heartbeat / Status Poll
app.get('/device/status/:deviceId', (req, res) => {
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (device) {
    device.lastSeen = new Date().toISOString();
    res.json({ status: device.status, lockReason: device.lockReason });
  } else {
    res.status(404).json({ error: 'Device not registered' });
  }
});

// Serve the APK (Placeholder - user should build and put it in 'public')
app.get('/app-debug.apk', (req, res) => {
    const apkPath = path.join(__dirname, 'public', 'app-debug.apk');
    res.sendFile(apkPath, (err) => {
        if (err) {
            res.status(404).send('APK not found. Please build the app and place app-debug.apk in the public folder.');
        }
    });
});

app.listen(port, () => {
  console.log(`KAVACH Admin Server running at http://localhost:${port}`);
});
