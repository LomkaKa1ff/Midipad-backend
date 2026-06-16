require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const Midi = require('./models/Midi');

const authRoutes = require('./routes/auth');
const midiRoutes = require('./routes/midi');

const app = express();

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Security (Helmet)
app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
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


// SEO injector
app.get('/track/:id', async (req, res) => {
    try {
        const trackId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(trackId)) {
            return res.status(404).send('Track not found');
        }

        const track = await Midi.findById(trackId);
        if (!track) {
            return res.status(404).send('Track not found');
        }

        const indexPath = path.resolve('/var/www/midipad/index.html');

        fs.readFile(indexPath, 'utf8', (err, htmlData) => {
            if (err) {
                console.error('Error reading index.html', err);
                return res.status(500).send('Server Error');
            }

            const title = `${track.title} MIDI Download - MidiPad`;
            const description = `Download the MIDI file for ${track.title} by ${track.author || 'Unknown'} for free.`;

            let injectedHtml = htmlData
                .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
                .replace(/<meta name="description" content=".*?"\s*\/?>/i, `<meta name="description" content="${description}" />`)
                .replace(/<meta property="og:title" content=".*?"\s*\/?>/i, `<meta property="og:title" content="${title}" />`)
                .replace(/<meta property="og:description" content=".*?"\s*\/?>/i, `<meta property="og:description" content="${description}" />`);

            if (track.coverUrl) {
                injectedHtml = injectedHtml.replace(
                    /<meta property="og:image" content=".*?"\s*\/?>/i,
                    `<meta property="og:image" content="https://midipad.net${track.coverUrl}" />`
                );
            }

            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

            res.send(injectedHtml);
        });
    } catch (error) {
        console.error('SEO Injection Error:', error);
        res.status(500).send('Server Error');
    }
});

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