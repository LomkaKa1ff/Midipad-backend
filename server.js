const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet'); // <--- ДОБАВИЛИ
const rateLimit = require('express-rate-limit'); // <--- ДОБАВИЛИ
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const authRoutes = require('./routes/auth');
const midiRoutes = require('./routes/midi');

const app = express();

// Настройка прокси (важно для правильной работы rate-limit на хостингах)
app.set('trust proxy', 1);

// --- БЕЗОПАСНОСТЬ ---
// 1. Helmet добавляет защитные заголовки
app.use(helmet());

// 2. Глобальный лимит: максимум 100 запросов за 15 минут с одного IP
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Too many requests, please try again later.' }
});
app.use(globalLimiter);

// 3. Строгий лимит для путей авторизации (защита от брутфорса)
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 час
    max: 5, // Только 5 попыток регистрации/логина в час
    message: { message: 'Too many login attempts, please try again in an hour.' }
});
app.use('/api/auth', authLimiter);
// ---------------------

// Middleware
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/midipad';

app.use('/api/auth', authRoutes);
app.use('/api/midi', midiRoutes);

// Подключение к MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
    res.send('MidiPad API is running!');
});

app.listen(PORT, () => {
    console.log(`Backend is running on http://localhost:${PORT}`);
});