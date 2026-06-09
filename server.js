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

app.set('trust proxy', 1);

// 1. ПАРСЕРЫ И CORS
app.use(cors());
app.use(express.json());

// 2. СЕССИИ И ПАСПОРТ
app.use(session({
    secret: process.env.JWT_SECRET || 'supersecretkey',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// 3. БЕЗОПАСНОСТЬ (HELMET)
// Отключаем жесткую политику ресурсов, чтобы браузер не блокировал файлы миди и шрифты плеера
app.use(helmet({
    crossOriginResourcePolicy: false,
}));

// 👇👇👇 ГЛАВНЫЙ ФИКС ЗДЕСЬ 👇👇👇

// 4. СНАЧАЛА ОТДАЕМ ФАЙЛЫ (Они не расходуют лимит запросов!)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 5. И ТОЛЬКО ТЕПЕРЬ СТАВИМ ЛИМИТЫ (Только для /api)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 200, // Лимит чисто на походы к базе данных и лайки
    message: { message: 'Too many requests, please try again later.' }
});
// Применяем глобальный лимит ТОЛЬКО к маршрутам API
app.use('/api', globalLimiter);

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 50, // Оставь 50 пока делаешь сайт. Потом поменяешь на 5-10
    message: { message: 'Too many login attempts, please try again in an hour.' }
});
app.use('/api/auth', authLimiter);

// 👆👆👆 ---------------------- 👆👆👆

// 6. РОУТЫ
app.use('/api/auth', authRoutes);
app.use('/api/midi', midiRoutes);

// 7. БАЗА ДАННЫХ И ЗАПУСК
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