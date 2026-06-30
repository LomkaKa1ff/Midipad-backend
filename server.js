require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const authRoutes = require('./routes/auth');
const midiRoutes = require('./routes/midi');

const app = express();

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Security (Helmet)
app.use(helmet({
    crossOriginResourcePolicy: false,
}));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Limits (Only for /api)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { message: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 15,
    message: { message: 'Too many login attempts, please try again in an hour.' }
});
app.use('/api/auth', authLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/midi', midiRoutes);

// DB and start
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