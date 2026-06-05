const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware (разрешаем запросы с фронтенда и чтение JSON)
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
// Строка подключения к локальной MongoDB (база создастся сама при первой записи)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/midipad';

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Подключение к MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Тестовый роут
app.get('/', (req, res) => {
    res.send('MidiPad API is running!');
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Backend is running on http://localhost:${PORT}`);
});