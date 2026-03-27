const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const archiver = require('archiver');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const storage = require('./data/storage');

const app = express();
const PORT = 3000;

// Session middleware for admin login (no token)
app.use(session({
    secret: 'wolf-pack-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

storage.initData();

const contactsDir = path.join(__dirname, 'contacts');
const archivesDir = path.join(__dirname, 'archives');
if (!fs.existsSync(contactsDir)) fs.mkdirSync(contactsDir, { recursive: true });
if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });

// ============ PUBLIC ROUTES ============

app.get('/api/stats', (req, res) => {
    try {
        const stats = storage.getStats();
        const settings = storage.getSettings();
        res.json({ stats, settings });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/wolf-quote', (req, res) => {
    try {
        const quotes = storage.getWolfQuotes();
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        res.json({ quote: randomQuote });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/zip-releases', (req, res) => {
    try {
        const releases = storage.getZipReleases();
        res.json(releases);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// User Registration
app.post('/api/register', (req, res) => {
    try {
        const { name, phone, password } = req.body;
        if (!name || !phone || !password) {
            return res.status(400).json({ error: 'Name, phone, and password are required' });
        }
        const result = storage.registerUser(name, phone, password);
        if (result.error) return res.status(400).json({ error: result.error });
        const settings = storage.getSettings();
        res.json({ 
            success: true, 
            message: result.message,
            user: result.user,
            whatsappLink: settings.whatsapp_group_link
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// User Login
app.post('/api/login', (req, res) => {
    try {
        const { phone, password } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ error: 'Phone and password are required' });
        }
        const result = storage.loginUser(phone, password);
        if (result.error) return res.status(401).json({ error: result.error });
        
        // Set session for user
        req.session.userId = result.user.id;
        req.session.userName = result.user.name;
        
        res.json({ 
            success: true, 
            message: `Welcome back, ${result.user.name}!`,
            user: result.user
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get current user
app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
        return res.json({ loggedIn: false });
    }
    const user = storage.getUserById(req.session.userId);
    if (!user) {
        req.session.destroy();
        return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, user });
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Download VCF (requires login)
app.get('/api/download/:id', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Please login first' });
    }
    try {
        const user = storage.getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Contact not found' });
        const filepath = path.join(contactsDir, user.vcf_filename);
        if (fs.existsSync(filepath)) {
            storage.recordDownload(user.id);
            res.download(filepath, `${user.name.replace(/\s/g, '_')}.vcf`);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/zip-download/:id', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Please login first' });
    }
    try {
        const releases = storage.getZipReleases();
        const zip = releases.find(z => z.id === parseInt(req.params.id));
        if (!zip) return res.status(404).json({ error: 'Release not found' });
        const zipPath = path.join(archivesDir, zip.filename);
        if (fs.existsSync(zipPath)) {
            storage.recordZipDownload(zip.id);
            res.download(zipPath, zip.filename);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ ADMIN ROUTES (Session-based, no token) ============

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (storage.verifyAdmin(username, password)) {
        req.session.isAdmin = true;
        req.session.adminName = username;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.json({ success: true });
});

// Check admin session
app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: req.session.isAdmin === true });
});

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ error: 'Admin access required' });
    }
};

app.get('/api/admin/users', requireAdmin, (req, res) => {
    try {
        const users = storage.getAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/admin/user/:id', requireAdmin, (req, res) => {
    try {
        storage.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const settings = storage.getSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        storage.updateSettings(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/wolf-quote', requireAdmin, (req, res) => {
    try {
        const { quote } = req.body;
        if (quote) {
            storage.addWolfQuote(quote);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Quote required' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/download-all', requireAdmin, (req, res) => {
    const users = storage.getAllUsers();
    if (users.length === 0) return res.status(404).json({ error: 'No contacts' });
    const archive = archiver('zip', { zlib: { level: 9 } });
    const settings = storage.getSettings();
    const zipName = `${settings.zip_name}_live_${new Date().toISOString().split('T')[0]}.zip`;
    res.attachment(zipName);
    archive.pipe(res);
    users.forEach(user => {
        const filepath = path.join(contactsDir, user.vcf_filename);
        if (fs.existsSync(filepath)) archive.file(filepath, { name: user.vcf_filename });
    });
    archive.finalize();
});

app.get('/api/admin/backup', requireAdmin, (req, res) => {
    try {
        const data = storage.getData();
        res.attachment(`backup_${new Date().toISOString().split('T')[0]}.json`);
        res.send(JSON.stringify(data, null, 2));
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ FRONTEND ============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '🐺'.repeat(50));
    console.log('🐺 PAXTON CONNECT V5 - WOLF PACK EDITION 🐺');
    console.log('🐺'.repeat(50));
    console.log(`✅ Server: http://localhost:${PORT}`);
    console.log(`📱 User Page: http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
    console.log(`🔑 Admin Login: admin / wolf123`);
    console.log(`📦 User Login/Register: Required to download`);
    console.log(`🕐 Live Counters: Active`);
    console.log('🐺'.repeat(50) + '\n');
});
