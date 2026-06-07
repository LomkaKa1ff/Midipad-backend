const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const authRoutes = require('./routes/auth');
const midiRoutes = require('./routes/midi');

const app = express();
app.set('trust proxy', 1);

// Middleware (разрешаем запросы с фронтенда и чтение JSON)
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 5000;
// Строка подключения к локальной MongoDB (база создастся сама при первой записи)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/midipad';

app.use('/api/auth', authRoutes);
app.use('/api/midi', midiRoutes);

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