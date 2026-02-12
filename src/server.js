// Telegram verification service
require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CODE_TTL_SECONDS = Number(process.env.CODE_TTL_SECONDS || 300);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 5);
const START_SESSION_TTL_SECONDS = Number(process.env.START_SESSION_TTL_SECONDS || 600);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || null;
const ADMIN_TELEGRAM_ID = Number(process.env.ADMIN_TELEGRAM_ID || 0);
const ADMIN_UI_DIR = path.join(__dirname, '..', 'public', 'admin');

if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');

// DB
mongoose.set('strictQuery', true);
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

const userSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    phone: { type: String, index: true },
    telegramId: { type: Number, index: true },
    username: { type: String },
  },
  { timestamps: true }
);

const codeSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    phone: { type: String, index: true },
    codeHash: { type: String },
    expiresAt: { type: Date, index: true },
    attempts: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    key: { type: String, unique: true, index: true },
    code: { type: String, unique: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const startSessionSchema = new mongoose.Schema(
  {
    chatId: { type: Number, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true }
);

startSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const adminActionSchema = new mongoose.Schema(
  {
    chatId: { type: Number, index: true },
    type: { type: String, index: true },
    step: { type: String },
    payload: { type: Object, default: {} },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true }
);

adminActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

userSchema.index({ projectId: 1, phone: 1 }, { unique: true });
userSchema.index({ projectId: 1, telegramId: 1 }, { unique: true });
codeSchema.index({ projectId: 1, phone: 1, createdAt: -1 });

const Project = mongoose.model('Project', projectSchema);
const StartSession = mongoose.model('StartSession', startSessionSchema);
const AdminAction = mongoose.model('AdminAction', adminActionSchema);
const User = mongoose.model('User', userSchema);
const VerificationCode = mongoose.model('VerificationCode', codeSchema);

// Cleanup legacy index if it exists (projectKey -> now "key")
mongoose.connection.once('open', async () => {
  try {
    const indexes = await Project.collection.indexes();
    const legacy = indexes.find((idx) => idx.name === 'projectKey_1');
    if (legacy) {
      await Project.collection.dropIndex('projectKey_1');
      console.log('Dropped legacy index: projectKey_1');
    }
  } catch (err) {
    console.warn('Index cleanup skipped:', err.message || err);
  }
});

// Telegram bot (polling)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const startArg = (msg.text || '').split(' ')[1] || '';
  if (!startArg) {
    await bot.sendMessage(
      chatId,
      'Assalomu alaykum! Iltimos, loyiha kodi bilan /start buyrug‘ini yuboring.'
    );
    return;
  }

  const project = await Project.findOne({ code: startArg, isActive: true });
  if (!project) {
    await bot.sendMessage(chatId, 'Loyiha kodi topilmadi yoki faol emas.');
    return;
  }

  const expiresAt = new Date(Date.now() + START_SESSION_TTL_SECONDS * 1000);
  await StartSession.create({ chatId, projectId: project._id, expiresAt });

  await bot.sendMessage(chatId, 'Assalomu alaykum! Telefon raqamingizni yuboring.', {
    reply_markup: {
      keyboard: [[{ text: 'Telefon raqamni yuborish', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
});

bot.onText(/\/add_project/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isTelegramAdmin(msg)) {
    await bot.sendMessage(chatId, 'Ruxsat yo‘q.');
    return;
  }

  await createAdminAction(chatId, 'add_project', 'await_name');
  await bot.sendMessage(chatId, 'Yangi loyiha nomini yuboring.');
});

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;

  if (!contact || !contact.phone_number) {
    return bot.sendMessage(chatId, 'Telefon raqamni topa olmadim. Qayta yuboring.');
  }

  const phone = normalizePhone(contact.phone_number);
  const username = msg.from?.username || '';

  try {
    const session = await StartSession.findOne({ chatId }).sort({ createdAt: -1 });
    if (!session || session.expiresAt < new Date()) {
      await bot.sendMessage(
        chatId,
        'Sessiya topilmadi. Iltimos, /start <loyiha_kodi> buyrug‘ini yuboring.'
      );
      return;
    }

    const project = await Project.findById(session.projectId);
    if (!project || !project.isActive) {
      await bot.sendMessage(chatId, 'Loyiha faol emas.');
      return;
    }

    await User.findOneAndUpdate(
      { projectId: project._id, phone },
      { projectId: project._id, phone, telegramId: chatId, username },
      { upsert: true, new: true }
    );
    await bot.sendMessage(chatId, `Raqamingiz ulandi: ${phone}`);
  } catch (err) {
    console.error('User link error', err);
    await bot.sendMessage(chatId, 'Xatolik yuz berdi. Keyinroq urinib ko‘ring.');
  }
});

bot.on('message', async (msg) => {
  if (!msg.text) return;

  if (isTelegramAdmin(msg)) {
    const action = await getActiveAdminAction(msg.chat.id, 'add_project');
    if (action && action.step === 'await_name') {
      const name = msg.text.trim();
      if (!name || name.startsWith('/')) {
        await bot.sendMessage(msg.chat.id, 'Loyiha nomini oddiy matn sifatida yuboring.');
        return;
      }
      const updated = await updateAdminAction(action._id, 'confirm', { name });
      await bot.sendMessage(msg.chat.id, `Loyiha nomi: ${name}\nTasdiqlaysizmi?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Tasdiqlash', callback_data: `add_project_confirm:${updated._id}` }],
            [{ text: 'Bekor qilish', callback_data: `add_project_cancel:${updated._id}` }],
          ],
        },
      });
      return;
    }
  }

  if (msg.text && msg.text !== '/start') {
    await bot.sendMessage(msg.chat.id, 'Iltimos, /start buyrug‘ini bosing yoki telefon raqamingizni yuboring.');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;

  if (!isTelegramAdmin(query)) {
    await bot.answerCallbackQuery(query.id, { text: 'Ruxsat yo‘q.' });
    return;
  }

  const data = query.data || '';
  if (data.startsWith('add_project_confirm:')) {
    const actionId = data.split(':')[1];
    const action = await AdminAction.findById(actionId);
    if (!action || action.expiresAt < new Date()) {
      await bot.answerCallbackQuery(query.id, { text: 'Sessiya tugagan.' });
      return;
    }

    const name = action.payload?.name || 'Untitled';
    const project = await Project.create({
      name,
      key: generateKey(24),
      code: generateCodeKey(4),
      isActive: true,
    });

    await completeAdminAction(actionId);
    await bot.answerCallbackQuery(query.id, { text: 'Yaratildi.' });
    await bot.sendMessage(
      chatId,
      `Loyiha yaratildi.\nName: ${project.name}\nID: ${project._id}\nAPI-KEY: ${project.key}\nCode: ${project.code}`
    );
    return;
  }

  if (data.startsWith('add_project_cancel:')) {
    const actionId = data.split(':')[1];
    await completeAdminAction(actionId);
    await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi.' });
    await bot.sendMessage(chatId, 'Yaratish bekor qilindi.');
  }
});

// Helpers
function normalizePhone(input) {
  return String(input).replace(/[^+0-9]/g, '');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateKey(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateCodeKey(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

function isTelegramAdmin(msg) {
  if (!ADMIN_TELEGRAM_ID) return false;
  return msg?.from?.id === ADMIN_TELEGRAM_ID;
}

async function createAdminAction(chatId, type, step, payload = {}) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  return AdminAction.create({ chatId, type, step, payload, expiresAt });
}

async function getActiveAdminAction(chatId, type) {
  const action = await AdminAction.findOne({ chatId, type }).sort({ createdAt: -1 });
  if (!action) return null;
  if (action.expiresAt < new Date()) return null;
  return action;
}

async function updateAdminAction(actionId, step, payload = {}) {
  return AdminAction.findByIdAndUpdate(
    actionId,
    { step, payload, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    { new: true }
  );
}

async function completeAdminAction(actionId) {
  return AdminAction.findByIdAndUpdate(
    actionId,
    { step: 'done', expiresAt: new Date(Date.now() - 1000) },
    { new: true }
  );
}

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) return res.status(503).json({ error: 'admin disabled' });
  const key = req.header('x-admin-key');
  if (!key || key !== ADMIN_API_KEY) return res.status(401).json({ error: 'invalid admin key' });
  return next();
}

async function requireProject(req, res, next) {
  const projectKey = req.header('x-project-key');
  if (!projectKey) return res.status(400).json({ error: 'project key required' });

  const project = await Project.findOne({ key: projectKey, isActive: true });
  if (!project) return res.status(401).json({ error: 'invalid project key' });

  req.project = project;
  return next();
}

// API
app.use('/admin', express.static(ADMIN_UI_DIR));

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// Send code directly to telegram user_id
app.post('/notify', requireProject, async (req, res) => {
  const userId = req.body?.user_id;
  const code = req.body?.code;

  if (!userId || !code) return res.status(400).json({ error: 'user_id and code required' });

  try {
    await bot.sendMessage(Number(userId), `Tasdiqlash kodi: ${code}`);
    res.json({ status: 'sent' });
  } catch (err) {
    console.error('Notify error', err);
    res.status(400).json({ error: 'cannot send to user_id' });
  }
});

// Admin: create/list projects
app.post('/projects', requireAdmin, async (req, res) => {
  const name = req.body?.name;
  if (!name) return res.status(400).json({ error: 'name required' });

  const project = await Project.create({
    name,
    key: generateKey(24),
    code: generateCodeKey(4),
    isActive: true,
  });

  res.json({ id: project._id, name: project.name, key: project.key, code: project.code });
});

app.get('/projects', requireAdmin, async (req, res) => {
  const projects = await Project.find({}, { name: 1, code: 1, key: 1, isActive: 1 }).sort({
    createdAt: -1,
  });
  res.json({ projects });
});

// Request a new code
app.post('/auth/request', requireProject, async (req, res) => {
  const phoneRaw = req.body?.phone;
  if (!phoneRaw) return res.status(400).json({ error: 'phone required' });

  const phone = normalizePhone(phoneRaw);
  const user = await User.findOne({ projectId: req.project._id, phone });
  if (!user) return res.status(404).json({ error: 'phone not linked to telegram' });

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);

  await VerificationCode.create({
    projectId: req.project._id,
    phone,
    codeHash,
    expiresAt,
    attempts: 0,
    usedAt: null,
  });

  await bot.sendMessage(user.telegramId, `Tasdiqlash kodi: ${code}\nU ${CODE_TTL_SECONDS} soniya ichida amal qiladi.`);

  res.json({ status: 'sent' });
});

// Check if phone is linked to project
app.post('/auth/check', requireProject, async (req, res) => {
  const phoneRaw = req.body?.phone;
  if (!phoneRaw) return res.status(400).json({ error: 'phone required' });

  const phone = normalizePhone(phoneRaw);
  const exists = await User.exists({ projectId: req.project._id, phone });
  res.json({ check: Boolean(exists) });
});

// Verify code
app.post('/auth/verify', requireProject, async (req, res) => {
  const phoneRaw = req.body?.phone;
  const code = req.body?.code;

  if (!phoneRaw || !code) return res.status(400).json({ error: 'phone and code required' });

  const phone = normalizePhone(phoneRaw);

  const record = await VerificationCode.findOne({
    projectId: req.project._id,
    phone,
    usedAt: null,
  }).sort({ createdAt: -1 });
  if (!record) return res.status(400).json({ error: 'code not found' });

  if (record.expiresAt < new Date()) return res.status(400).json({ error: 'code expired' });

  if (record.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'too many attempts' });

  const incomingHash = hashCode(code);
  if (incomingHash !== record.codeHash) {
    record.attempts += 1;
    await record.save();
    return res.status(400).json({ error: 'invalid code' });
  }

  record.usedAt = new Date();
  await record.save();

  res.json({ status: 'verified' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
