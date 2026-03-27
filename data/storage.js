const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, 'data.json');
const CONTACTS_DIR = path.join(__dirname, '..', 'contacts');
const ARCHIVES_DIR = path.join(__dirname, '..', 'archives');

if (!fs.existsSync(CONTACTS_DIR)) fs.mkdirSync(CONTACTS_DIR, { recursive: true });
if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

const initData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        const defaultData = {
            users: [],
            admins: [{ username: 'admin', password: bcrypt.hashSync('wolf123', 10) }],
            zipReleases: [],
            settings: {
                zip_name: 'wolf-pack-contacts',
                default_duration: 30,
                whatsapp_group_link: 'https://chat.whatsapp.com/HjFc3pud3IA0R0WGr1V2Xu',
                whatsapp_channel_link: 'https://whatsapp.com/channel/0029VaGyP933bbVC7G0x0i2T',
                welcome_message: 'Welcome to the Wolf Pack! 🐺',
                zip_target: 500
            },
            nextId: 1,
            nextZipId: 1,
            stats: {
                total_contacts: 0,
                active_contacts: 0,
                expired_contacts: 0,
                total_downloads: 0,
                total_zip_releases: 0
            },
            wolfQuotes: [
                "The wolf on the hill is not as hungry as the wolf climbing the hill.",
                "A wolf doesn't concern himself with the opinion of sheep.",
                "Lone wolves are the strongest, but the pack survives together.",
                "Howl at the moon, for tomorrow is another hunt.",
                "The strength of the wolf is the pack, and the strength of the pack is the wolf."
            ]
        };
        fs.writeJsonSync(DATA_FILE, defaultData, { spaces: 2 });
    }
    return fs.readJsonSync(DATA_FILE);
};

const saveData = (data) => { fs.writeJsonSync(DATA_FILE, data, { spaces: 2 }); };
const getData = () => { if (!fs.existsSync(DATA_FILE)) return initData(); return fs.readJsonSync(DATA_FILE); };

const formatPhone = (phone) => {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('27') && cleaned.length === 11) return `+${cleaned}`;
    if (cleaned.startsWith('0')) cleaned = '27' + cleaned.substring(1);
    if (!cleaned.startsWith('27') && cleaned.length === 9) cleaned = '27' + cleaned;
    if (!cleaned.startsWith('+')) return `+${cleaned}`;
    return phone;
};

const generateVCF = (name, phone, id, durationDays) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:${phone}
NOTE:Added via PAXTON Connect
CREATED:${new Date().toISOString()}
EXPIRES:${expiresAt.toISOString()}
END:VCARD`;
    const filename = `${id}_${name.replace(/\s/g, '_')}.vcf`;
    const filepath = path.join(CONTACTS_DIR, filename);
    fs.writeFileSync(filepath, vcf, 'utf8');
    return { filename, expires_at: expiresAt.toISOString() };
};

const addUser = (name, phone, password = null) => {
    const data = getData();
    const formattedPhone = formatPhone(phone);
    
    // Check if phone exists
    if (data.users.some(u => u.phone === formattedPhone)) {
        return { error: 'This phone number is already registered!' };
    }
    
    const settings = data.settings;
    const durationDays = settings.default_duration || 30;
    const id = data.nextId++;
    const { filename, expires_at } = generateVCF(name, formattedPhone, id, durationDays);
    
    const newUser = {
        id, name, phone: formattedPhone, vcf_filename: filename,
        created_at: new Date().toISOString(), expires_at,
        duration_days: durationDays, download_count: 0,
        password: password ? bcrypt.hashSync(password, 10) : null,
        last_login: null
    };
    
    data.users.unshift(newUser);
    const now = new Date();
    data.stats.total_contacts = data.users.length;
    data.stats.active_contacts = data.users.filter(u => new Date(u.expires_at) > now).length;
    data.stats.expired_contacts = data.users.filter(u => new Date(u.expires_at) <= now).length;
    saveData(data);
    return { success: true, user: newUser };
};

const loginUser = (phone, password) => {
    const data = getData();
    const user = data.users.find(u => u.phone === formatPhone(phone));
    if (!user) return { error: 'Phone number not registered' };
    if (!user.password) return { error: 'No password set for this account. Please register first.' };
    if (!bcrypt.compareSync(password, user.password)) return { error: 'Invalid password' };
    user.last_login = new Date().toISOString();
    saveData(data);
    return { success: true, user };
};

const registerUser = (name, phone, password) => {
    const result = addUser(name, phone, password);
    if (result.error) return result;
    return { success: true, user: result.user, message: 'Registration successful! You can now login.' };
};

const getAllUsers = () => { const data = getData(); return data.users; };
const getUserById = (id) => { const data = getData(); return data.users.find(u => u.id === parseInt(id)); };
const deleteUser = (id) => {
    const data = getData();
    const user = data.users.find(u => u.id === parseInt(id));
    if (user) {
        const filepath = path.join(CONTACTS_DIR, user.vcf_filename);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        data.users = data.users.filter(u => u.id !== parseInt(id));
        const now = new Date();
        data.stats.total_contacts = data.users.length;
        data.stats.active_contacts = data.users.filter(u => new Date(u.expires_at) > now).length;
        data.stats.expired_contacts = data.users.filter(u => new Date(u.expires_at) <= now).length;
        saveData(data);
        return true;
    }
    return false;
};

const recordDownload = (id) => {
    const data = getData();
    const user = data.users.find(u => u.id === parseInt(id));
    if (user) { user.download_count++; data.stats.total_downloads++; saveData(data); return true; }
    return false;
};

const getSettings = () => { const data = getData(); return data.settings; };
const updateSettings = (newSettings) => { const data = getData(); data.settings = { ...data.settings, ...newSettings }; saveData(data); return data.settings; };
const getStats = () => { const data = getData(); return data.stats; };
const getWolfQuotes = () => { const data = getData(); return data.wolfQuotes; };
const addWolfQuote = (quote) => { const data = getData(); data.wolfQuotes.push(quote); saveData(data); return data.wolfQuotes; };
const getAdmins = () => { const data = getData(); return data.admins; };
const verifyAdmin = (username, password) => {
    const data = getData();
    const admin = data.admins.find(a => a.username === username);
    if (!admin) return false;
    return bcrypt.compareSync(password, admin.password);
};
const getZipReleases = () => { const data = getData(); return data.zipReleases; };
const recordZipDownload = (id) => {
    const data = getData();
    const zip = data.zipReleases.find(z => z.id === parseInt(id));
    if (zip) { zip.download_count++; data.stats.total_zip_downloads++; saveData(data); return true; }
    return false;
};

module.exports = {
    initData, addUser, getAllUsers, getUserById, deleteUser, recordDownload,
    getSettings, updateSettings, getStats, getWolfQuotes, addWolfQuote,
    verifyAdmin, getZipReleases, recordZipDownload, loginUser, registerUser, getAdmins
};
