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
  .then(async () => {
    console.log('Connected to MongoDB');
    try {
      await mongoose.connection.collection('devices').dropIndex('deviceId_1');
    } catch (err) {}
  })
  .catch(err => console.error('MongoDB connection error:', err));

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, sparse: true, unique: true },
  name: String,
  email: String,
  mobile: { type: String, required: true },
  model: { type: String, default: 'Awaiting Setup...' },
  androidVersion: { type: String, default: '-' },
  registrationToken: { type: String, unique: true },
  unlockPin: String,
  lockReason: { type: String, default: 'Security Policy Violation' },
  status: { type: String, enum: ['LOCKED', 'UNLOCKED', 'FREE_PENDING', 'FREE'], default: 'UNLOCKED' },
  isRegistered: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

const Device = mongoose.model('Device', DeviceSchema);

// --- ADMIN API ---

app.post('/admin/generate-qr', async (req, res) => {
  const { name, email, mobile } = req.body;
  if (!name || !email || !mobile) return res.status(400).json({ error: 'Missing required fields' });

  const token = Math.random().toString(36).substring(2, 15);
  const unlockPin = Math.floor(10000000 + Math.random() * 90000000).toString();

  try {
    const device = await Device.create({ registrationToken: token, name, email, mobile, unlockPin, isRegistered: false, status: 'UNLOCKED' });

    const provisioningJson = {
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.example.kavach/com.example.kavach.receiver.KavachDeviceAdminReceiver",
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://kavach-aar4.onrender.com/apk/app-debug.apk",
      "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": "DvgqQeiVIsrMPaimEbRpSBbkyGd-RIpCl3v_b03RKfs",
      "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
      "android.app.extra.PROVISIONING_MODE": 1,
      "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
      "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
        "registration_token": token,
        "unlock_pin": unlockPin
      }
    };

    console.log(`[ADMIN] QR Generated for ${name} (${token})`);
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(provisioningJson));
    res.json({ qrCode: qrDataUrl, token, unlockPin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.get('/admin/check-registration/:token', async (req, res) => {
  const device = await Device.findOne({ registrationToken: req.params.token });
  res.json({ isRegistered: device ? device.isRegistered : false });
});

app.get('/admin/devices', async (req, res) => {
  const devices = await Device.find().sort({ lastSeen: -1 });
  res.json(devices);
});

app.post('/admin/update-status/:id', async (req, res) => {
  const { status, reason } = req.body;
  console.log(`[ADMIN] Request to change ${req.params.id} to ${status}`);
  try {
    const update = { status };
    if (reason) update.lockReason = reason;
    await Device.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/admin/device/:id', async (req, res) => {
  try {
    await Device.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// --- DEVICE API ---

app.post('/device/register', async (req, res) => {
  const { token, deviceId, model, androidVersion } = req.body;
  console.log(`[DEVICE] Incoming registration: ${token} from ${deviceId}`);

  try {
    const device = await Device.findOne({ registrationToken: token });
    if (!device) {
        console.warn(`[DEVICE] Registration failed: Token ${token} not found`);
        return res.status(404).json({ error: 'Invalid token' });
    }

    device.deviceId = deviceId;
    device.model = model;
    device.androidVersion = androidVersion;
    device.isRegistered = true;
    device.lastSeen = new Date();
    await device.save();
    console.log(`[DEVICE] Registration SUCCESS for ${device.name}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[DEVICE] Registration DB Error: ${err.message}`);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/device/status/:deviceId', async (req, res) => {
  const device = await Device.findOne({ deviceId: req.params.deviceId });
  if (!device) return res.status(404).json({ error: 'Not found' });

  device.lastSeen = new Date();
  await device.save();

  console.log(`[HEARTBEAT] ${device.name} checked in. Status: ${device.status}`);

  res.json({
    status: device.status,
    lockReason: device.lockReason
  });
});

app.post('/device/confirm-free/:deviceId', async (req, res) => {
  try {
    await Device.findOneAndUpdate({ deviceId: req.params.deviceId }, { status: 'FREE' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

// --- ADMIN UI ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>KAVACH Enterprise Dashboard</title>
      <style>
        body { font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; height: 100vh; background: #f0f2f5; }
        #sidebar { width: 320px; background: #fff; border-right: 1px solid #ddd; padding: 25px; box-shadow: 2px 0 5px rgba(0,0,0,0.05); }
        #main { flex: 1; padding: 40px; overflow-y: auto; }
        input { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
        .primary-btn { width: 100%; padding: 14px; background: #007bff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
        table { width: 100%; background: #fff; border-collapse: collapse; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        th, td { padding: 18px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: 600; color: #666; }
        .status-pill { padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
        .LOCKED { background: #ffebee; color: #d32f2f; }
        .UNLOCKED { background: #e3f2fd; color: #1976d2; }
        .FREE_PENDING { background: #fff3e0; color: #f57c00; }
        .FREE { background: #e8f5e9; color: #388e3c; }
        .PENDING { background: #fdf6e3; color: #b58900; }

        .dropdown { position: relative; display: inline-block; }
        .dropbtn { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; padding: 5px 10px; }
        .dropdown-content { display: none; position: absolute; right: 0; background-color: #fff; min-width: 160px; box-shadow: 0 8px 16px rgba(0,0,0,0.1); z-index: 2000; border-radius: 6px; border: 1px solid #eee; }
        .dropdown-content a { color: #333; padding: 12px 16px; text-decoration: none; display: block; font-size: 13px; }
        .dropdown-content a:hover { background-color: #f8f9fa; }
        .dropdown:hover .dropdown-content { display: block; }

        #qr-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 3000; justify-content: center; align-items: center; }
        .modal-content { background: #fff; padding: 30px; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; }
        #qr-img { width: 220px; height: 220px; margin: 20px 0; }
        .pin-box { background: #f8f9fa; padding: 10px; border-radius: 6px; font-weight: bold; border: 1px dashed #007bff; color: #007bff; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div id="sidebar">
        <h2 style="color:#007bff;">KAVACH Admin</h2>
        <input type="text" id="custName" placeholder="Full Name">
        <input type="email" id="custEmail" placeholder="Email Address">
        <input type="text" id="custMobile" placeholder="Mobile Number">
        <button class="primary-btn" onclick="generateQR()">Generate QR</button>
      </div>

      <div id="main">
        <h1>Managed Devices</h1>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Hardware</th>
              <th>PIN</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="device-list"></tbody>
        </table>
      </div>

      <div id="qr-modal">
        <div class="modal-content">
          <h2>Registration QR</h2>
          <div id="qr-loading">
            <img id="qr-img" src="">
            <p><strong>Emergency PIN:</strong> <span id="pin-val" class="pin-box"></span></p>
            <p style="color: #666; font-size: 13px;">Waiting for device check-in...</p>
          </div>
          <div id="qr-success" style="display:none;">
            <div style="font-size: 60px; color: #4caf50;">✓</div>
            <h3>Device Registered!</h3>
            <button class="primary-btn" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>

      <script>
        let pollInterval;

        async function generateQR() {
          const name = document.getElementById('custName').value;
          const email = document.getElementById('custEmail').value;
          const mobile = document.getElementById('custMobile').value;
          if(!name || !email || !mobile) return alert('All fields are mandatory.');

          const res = await fetch('/admin/generate-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, mobile })
          });
          const data = await res.json();

          document.getElementById('qr-img').src = data.qrCode;
          document.getElementById('pin-val').innerText = data.unlockPin;
          document.getElementById('qr-modal').style.display = 'flex';
          document.getElementById('qr-loading').style.display = 'block';
          document.getElementById('qr-success').style.display = 'none';

          if(pollInterval) clearInterval(pollInterval);
          pollInterval = setInterval(async () => {
            try {
                const check = await fetch('/admin/check-registration/' + data.token);
                const status = await check.json();
                if(status.isRegistered) {
                  document.getElementById('qr-loading').style.display = 'none';
                  document.getElementById('qr-success').style.display = 'block';
                  clearInterval(pollInterval);
                  loadDevices();
                }
            } catch (e) {}
          }, 3000);
        }

        function closeModal() { document.getElementById('qr-modal').style.display = 'none'; }

        async function loadDevices() {
          try {
              const res = await fetch('/admin/devices');
              const devices = await res.json();
              const list = document.getElementById('device-list');
              list.innerHTML = '';
              devices.forEach(d => {
                const statusClass = d.isRegistered ? d.status : 'PENDING';
                const statusText = d.isRegistered ? d.status : 'PENDING';

                const tr = document.createElement('tr');
                tr.innerHTML = \`
                    <td><strong>\${d.name}</strong><br><small>\${d.email}</small><br><small>\${d.mobile}</small></td>
                    <td>\${d.model}<br><small>v\${d.androidVersion}</small></td>
                    <td><code class="pin-box">\${d.unlockPin}</code></td>
                    <td><span class="status-pill \${statusClass}">\${statusText}</span></td>
                    <td>
                      <div class="dropdown">
                        <button class="dropbtn">⋮</button>
                        <div class="dropdown-content">
                          <a href="#" class="lock-link">🔒 Lock Phone</a>
                          <a href="#" class="unlock-link">🔓 Unlock Phone</a>
                          <a href="#" class="free-link">✅ Free Device</a>
                          <a href="#" class="remove-link" style="color:red;">🗑 Remove</a>
                        </div>
                      </div>
                    </td>
                \`;

                tr.querySelector('.lock-link').onclick = (e) => { e.preventDefault(); promptLock(d._id); };
                tr.querySelector('.unlock-link').onclick = (e) => { e.preventDefault(); updateStatus(d._id, 'UNLOCKED'); };
                tr.querySelector('.free-link').onclick = (e) => { e.preventDefault(); updateStatus(d._id, 'FREE_PENDING'); };
                tr.querySelector('.remove-link').onclick = (e) => { e.preventDefault(); deleteDevice(d._id); };

                list.appendChild(tr);
              });
          } catch (e) {}
        }

        function promptLock(id) {
          const reason = prompt("Lockdown Reason:", "Security Policy Violation");
          if (reason !== null) updateStatus(id, 'LOCKED', reason);
        }

        async function updateStatus(id, status, reason = "") {
          const res = await fetch('/admin/update-status/' + id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, reason })
          });
          if(res.ok) loadDevices();
        }

        async function deleteDevice(id) {
          if(!confirm('Remove this device?')) return;
          const res = await fetch('/admin/device/' + id, { method: 'DELETE' });
          if(res.ok) loadDevices();
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
