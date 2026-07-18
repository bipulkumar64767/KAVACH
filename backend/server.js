const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Setup
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, sparse: true, unique: true },
  name: String,
  email: String,
  model: String,
  androidVersion: String,
  registrationToken: { type: String, unique: true },
  status: { type: String, enum: ['LOCKED', 'UNLOCKED', 'FREE'], default: 'UNLOCKED' },
  isRegistered: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

const Device = mongoose.model('Device', DeviceSchema);

// --- ADMIN API ---

app.post('/admin/generate-qr', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and Email required' });

  const token = Math.random().toString(36).substring(2, 15);

  try {
    await Device.create({ registrationToken: token, name, email, isRegistered: false, status: 'UNLOCKED' });

    const provisioningJson = {
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.example.kavach/com.example.kavach.receiver.KavachDeviceAdminReceiver",
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": `${req.protocol}://${req.get('host')}/apk/app-debug.apk`,
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": "_fMmQpygfn_F6C0FoigZOc_yOUUUmBmzOqm9T2oRtKg",
      "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
      "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
        "registration_token": token
      }
    };

    console.log('Generating Provisioning JSON:', JSON.stringify(provisioningJson, null, 2));

    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(provisioningJson));
    res.json({ qrCode: qrDataUrl, token });
  } catch (err) {
    console.error('QR Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate QR: ' + err.message });
  }
});

app.get('/admin/devices', async (req, res) => {
  const devices = await Device.find({ isRegistered: true }).sort({ lastSeen: -1 });
  res.json(devices);
});

// Updated endpoint for 3 states
app.post('/admin/update-status/:deviceId', async (req, res) => {
  const { status } = req.body;
  if (!['LOCKED', 'UNLOCKED', 'FREE'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await Device.findOneAndUpdate({ deviceId: req.params.deviceId }, { status: status });
  res.json({ success: true, status: status });
});

// --- DEVICE API ---

app.post('/device/register', async (req, res) => {
  const { token, deviceId, model, androidVersion } = req.body;
  try {
    const device = await Device.findOne({ registrationToken: token });
    if (!device) return res.status(404).json({ error: 'Invalid token' });

    device.deviceId = deviceId;
    device.model = model;
    device.androidVersion = androidVersion;
    device.isRegistered = true;
    device.lastSeen = new Date();
    await device.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/device/status/:deviceId', async (req, res) => {
  const device = await Device.findOne({ deviceId: req.params.deviceId });
  if (!device) return res.status(404).json({ error: 'Not found' });

  device.lastSeen = new Date();
  await device.save();
  res.json({ status: device.status });
});

// --- ADMIN UI ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>KAVACH Enterprise Dashboard</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; display: flex; height: 100vh; background: #f0f2f5; }
        #sidebar { width: 300px; background: #fff; border-right: 1px solid #ddd; padding: 20px; box-shadow: 2px 0 5px rgba(0,0,0,0.05); }
        #main { flex: 1; padding: 40px; overflow-y: auto; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        button:hover { background: #0056b3; }
        table { width: 100%; background: #fff; border-collapse: collapse; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; color: #555; }
        .badge { padding: 5px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; }
        .locked { background: #ffebee; color: #c62828; }
        .unlocked { background: #e3f2fd; color: #1565c0; }
        .free { background: #e8f5e9; color: #2e7d32; }
        .action-btn { width: auto; padding: 6px 10px; font-size: 11px; margin-right: 5px; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .btn-lock { background: #f44336; }
        .btn-unlock { background: #2196f3; }
        .btn-free { background: #4caf50; }
        #qr-container { margin-top: 20px; text-align: center; display: none; background: #fff; padding: 10px; border: 1px dashed #007bff; }
        #qr-img { width: 100%; max-width: 200px; }
      </style>
    </head>
    <body>
      <div id="sidebar">
        <h2>Register New Device</h2>
        <input type="text" id="custName" placeholder="Customer Name">
        <input type="email" id="custEmail" placeholder="Customer Email">
        <button onclick="generateQR()">Generate Setup QR</button>
        <div id="qr-container">
          <p>Scan this on fresh device:</p>
          <img id="qr-img" src="" alt="QR Code">
          <p style="font-size: 10px; color: #888;">Token: <span id="token-val"></span></p>
        </div>
      </div>
      <div id="main">
        <h1>Managed Devices</h1>
        <table id="device-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Device Info</th>
              <th>Last Seen</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="device-list"></tbody>
        </table>
      </div>

      <script>
        async function generateQR() {
          const name = document.getElementById('custName').value;
          const email = document.getElementById('custEmail').value;
          if(!name || !email) return alert('Name and Email are required');

          const btn = document.querySelector('#sidebar button');
          btn.disabled = true;
          btn.innerText = 'Generating...';

          try {
            const res = await fetch('/admin/generate-qr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, email })
            });
            const data = await res.json();

            if (data.error) {
              alert('Error: ' + data.error);
            } else {
              document.getElementById('qr-img').src = data.qrCode;
              document.getElementById('token-val').innerText = data.token;
              document.getElementById('qr-container').style.display = 'block';
            }
          } catch (err) {
            alert('Connection Failed: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.innerText = 'Generate Setup QR';
          }
        }

        async function loadDevices() {
          const res = await fetch('/admin/devices');
          const devices = await res.json();
          const list = document.getElementById('device-list');
          list.innerHTML = '';
          devices.forEach(d => {
            const lastSeen = new Date(d.lastSeen).toLocaleTimeString();
            list.innerHTML += \`
              <tr>
                <td><strong>\${d.name}</strong><br><small>\${d.email}</small></td>
                <td>\${d.model}<br><small>Android \${d.androidVersion}</small></td>
                <td>\${lastSeen}</td>
                <td><span class="badge \${d.status.toLowerCase()}">\${d.status}</span></td>
                <td>
                  <button class="action-btn btn-lock" onclick="updateStatus('\${d.deviceId}', 'LOCKED')">LOCK</button>
                  <button class="action-btn btn-unlock" onclick="updateStatus('\${d.deviceId}', 'UNLOCKED')">UNLOCK</button>
                  <button class="action-btn btn-free" onclick="updateStatus('\${d.deviceId}', 'FREE')">FREE</button>
                </td>
              </tr>
            \`;
          });
        }

        async function updateStatus(id, status) {
          await fetch(\`/admin/update-status/\${id}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          });
          loadDevices();
        }

        setInterval(loadDevices, 10000);
        loadDevices();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
