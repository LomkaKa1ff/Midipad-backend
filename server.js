const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const session = require('express-session');
const passport = require('passport');

const authRoutes = require('./routes/auth');
const midiRoutes = require('./routes/midi');

const app = express();

// Настройка прокси (важно для правильной работы rate-limit на хостингах)
app.set('trust proxy', 1);

// 👇 1. СНАЧАЛА CORS И ПАРСЕРЫ
// Это гарантия того, что ЛЮБОЙ ответ сервера (даже ошибка лимита) дойдет до React
app.use(cors());
app.use(express.json());

// 👇 2. ПОТОМ СЕССИИ И ПАСПОРТ (ДЛЯ ДИСКОРДА)
app.use(session({
    secret: process.env.JWT_SECRET || 'supersecretkey',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// 👇 3. БЕЗОПАСНОСТЬ И ЛИМИТЫ ЗАПРОСОВ
// Helmet добавляет защитные заголовки
app.use(helmet());

// Глобальный лимит: максимум 100 запросов за 15 минут
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Too many requests, please try again later.' }
});
app.use(globalLimiter);

// Строгий лимит для путей авторизации (от брутфорса)
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 час
    max: 10,
    message: { message: 'Too many login attempts, please try again in an hour.' }
});
app.use('/api/auth', authLimiter);

// 👇 4. ПАПКА С ФАЙЛАМИ
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 👇 5. РОУТЫ (МАРШРУТЫ)
app.use('/api/auth', authRoutes);
app.use('/api/midi', midiRoutes);

// 👇 6. БАЗА ДАННЫХ И ЗАПУСК
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/midipad';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => {
    res.send('MidiPad API is running!');
});

app.listen(PORT, () => {
    console.log(`Backend is running on http://localhost:${PORT}`);
});