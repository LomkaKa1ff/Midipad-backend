const express = require('express');
const multer = require('multer');
const path = require('path');
const Midi = require('../models/Midi');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const router = express.Router();

// Simple Middleware token check
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token is not valid' });
    }
};

const coversDir = path.join(__dirname, '../uploads/covers');
if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
}

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'coverImage') {
            cb(null, 'uploads/covers/');
        } else {
            cb(null, 'uploads/');
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2097152 }
});

// Loading route (POST /api/midi/upload)
router.post('/upload', authMiddleware, upload.fields([
    { name: 'midiFile', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {
    try {
        const midiFile = req.files && req.files['midiFile'] ? req.files['midiFile'][0] : null;

        if (!midiFile) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        let parsedTags = [];
        if (req.body.tags) {
            try {
                parsedTags = JSON.parse(req.body.tags);
            } catch (e) {
                console.error("Error parsing tags:", e);
            }
        }

        let finalCover = null;
        const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

        if (coverFile) {
            finalCover = `/uploads/covers/${coverFile.filename}`;
        } else if (req.body.coverUrl) {
            finalCover = req.body.coverUrl;
        }

        const newMidi = new Midi({
            title: req.body.title,
            filename: midiFile.filename,
            originalName: midiFile.originalname,
            size: midiFile.size,
            uploader: req.user.id || req.user.userId || req.user._id,
            tags: parsedTags,
            coverImage: finalCover
        });

        await newMidi.save();

        res.status(201).json({ message: 'File uploaded successfully!', midi: newMidi });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during upload' });
    }
});

// Route for getting track (Search and sort support)
router.get('/', async (req, res) => {
    try {
        const { sort, search } = req.query;

        let query = {};
        let sortObj = { createdAt: -1 };

        // Search logic
        if (search) {
            query.title = { $regex: search, $options: 'i' };
        }

        // Sort logic
        if (sort === 'popular') {
            sortObj = { downloads: -1, likes: -1 };
        }
        else if (sort === 'trending') {
            const fourteenDaysAgo = new Date();
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

            query.createdAt = { $gte: fourteenDaysAgo };
            sortObj = { likes: -1, listens: -1 };
        }

        const midis = await Midi.find(query)
            .populate('uploader', 'username')
            .sort(sortObj);

        res.json(midis);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching tracks' });
    }
});

// Route for file downloading with his name (GET /api/midi/download/:id)
router.get('/download/:id', async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) {
            return res.status(404).json({ message: 'MIDI file not found in DB' });
        }

        const filePath = path.join(__dirname, '../uploads', midi.filename);

        // Getting name from website
        let downloadName = midi.title;

        // Checking for .mid or .midi
        if (!downloadName.toLowerCase().endsWith('.mid') && !downloadName.toLowerCase().endsWith('.midi')) {
            downloadName += '.mid';
        }

        // Serve the file with the new formatted name
        res.download(filePath, downloadName, (err) => {
            if (err) {
                console.error("Error downloading file:", err);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during file download' });
    }
});

// 1. Increment listens (called in player's useEffect)
router.post('/listen/:id', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // $addToSet adds IP only if it's not already in the array
        // $inc increments listens only if $addToSet actually added something
        const result = await Midi.updateOne(
            { _id: req.params.id, listenedByIps: { $ne: ip } },
            {
                $inc: { listens: 1 },
                $push: { listenedByIps: ip }
            }
        );

        const midi = await Midi.findById(req.params.id);
        res.json({ listens: midi.listens });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Like toggle
router.post('/like/:id', authMiddleware, async (req, res) => {
    try {
        const userId = (req.user.id || req.user.userId || req.user._id).toString();
        const midi = await Midi.findById(req.params.id);

        if (!midi) return res.status(404).json({ message: 'Track not found' });

        if (!midi.likedBy) midi.likedBy = [];

        // STRICT STRING COMPARISON
        const isLiked = midi.likedBy.some(id => id.toString() === userId);

        if (isLiked) {
            // Remove user ID from the array
            midi.likedBy = midi.likedBy.filter(id => id.toString() !== userId);
            midi.likes = Math.max(0, midi.likes - 1);
        } else {
            // Add user ID to the array
            midi.likedBy.push(userId);
            midi.likes += 1;
        }

        await midi.save();
        res.json({ likes: midi.likes, isLiked: !isLiked });
    } catch (err) {
        console.error("Like error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Increment downloads
router.post('/download-increment/:id', async (req, res) => {
    try {
        // Get user IP
        // If using Nginx/Heroku, ensure app.set('trust proxy', 1) is enabled in server.js
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // Update only if IP is not already in the list
        // $addToSet: adds element to array only if it's not there
        // $inc: increments downloads by 1 ONLY if $addToSet actually added something
        const result = await Midi.updateOne(
            { _id: req.params.id, downloadedByIps: { $ne: ip } },
            {
                $inc: { downloads: 1 },
                $push: { downloadedByIps: ip }
            }
        );

        // Get the actual count to return to frontend
        const midi = await Midi.findById(req.params.id);
        res.json({ downloads: midi.downloads });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1. GET UPLOADED TRACKS BY USER
router.get('/profile/uploads', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId || req.user._id;
        const myMidis = await Midi.find({ uploader: userId })
            .populate('uploader', 'username')
            .sort({ createdAt: -1 });

        res.json(myMidis);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching user uploads' });
    }
});

// 2. GET LIKED TRACKS BY USER
router.get('/profile/liked', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId || req.user._id;
        const likedMidis = await Midi.find({ likedBy: userId })
            .populate('uploader', 'username')
            .sort({ createdAt: -1 });

        res.json(likedMidis);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching liked tracks' });
    }
});

// GET SINGLE TRACK (For sharing page)
router.get('/track/:id', async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id).populate('uploader', 'username');
        if (!midi) {
            return res.status(404).json({ message: 'Track not found' });
        }
        res.json(midi);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching track' });
    }
});

// ADD COMMENT TO TRACK
router.post('/:id/comment', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.trim() === '') {
            return res.status(400).json({ message: 'Comment text cannot be empty' });
        }

        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        const userId = req.user.id || req.user.userId || req.user._id;

        const newComment = {
            text: text.trim(),
            username: req.user.username || 'User',
            userId: userId,
            createdAt: new Date()
        };

        if (!midi.comments) midi.comments = [];
        midi.comments.push(newComment);

        await midi.save(); // Now Mongoose won't strip the comment!

        res.status(201).json(midi);
    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ message: 'Server error adding comment' });
    }
});

// DELETE OWN COMMENT (DELETE /api/midi/:id/comment/:commentId)
router.delete('/:id/comment/:commentId', authMiddleware, async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        // Find comment index in the array
        const commentIndex = midi.comments.findIndex(c => c._id.toString() === req.params.commentId);

        if (commentIndex === -1) return res.status(404).json({ message: 'Comment not found' });

        // Check if user is the author of the comment
        const userId = req.user.id || req.user.userId || req.user._id;
        if (midi.comments[commentIndex].userId.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Authorization denied (not the author)' });
        }

        // Remove comment from array using splice
        midi.comments.splice(commentIndex, 1);
        await midi.save();

        // Return the updated track
        res.json(midi);
    } catch (error) {
        console.error("Error deleting comment:", error);
        res.status(500).json({ message: 'Server error deleting comment' });
    }
});

// DELETE OWN TRACK (DELETE /api/midi/:id)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        // 1. Check if user is the author of this track
        const userId = req.user.id || req.user.userId || req.user._id;
        if (midi.uploader.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Authorization denied (not the author)' });
        }

        // 2. Physically delete the file from uploads directory
        const filePath = path.join(__dirname, '..', 'uploads', midi.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); // Removes file from disk
        }

        // ОПЦИОНАЛЬНО: удаляем картинку обложки, если она есть и это файл (а не url)
        if (midi.coverImage && midi.coverImage.startsWith('/uploads/covers/')) {
            const coverPath = path.join(__dirname, '..', midi.coverImage);
            if (fs.existsSync(coverPath)) {
                fs.unlinkSync(coverPath);
            }
        }

        // 3. Delete document from MongoDB database
        await Midi.findByIdAndDelete(req.params.id);

        res.json({ message: 'Track deleted successfully' });
    } catch (error) {
        console.error("Error deleting track:", error);
        res.status(500).json({ message: 'Server error deleting track' });
    }
});

// SEARCH TRACKS BY TAG (GET /api/midi/tag/:tag)
router.get('/tag/:tag', async (req, res) => {
    try {
        const tagToSearch = req.params.tag.toLowerCase(); // Convert to lowercase for reliability

        // Find all tracks that have the exact word in their tags array
        const midis = await Midi.find({ tags: tagToSearch })
            .populate('uploader', 'username')
            .sort({ createdAt: -1 }); // Newest on top

        res.json(midis);
    } catch (error) {
        console.error("Error fetching by tag:", error);
        res.status(500).json({ message: 'Server error fetching tags' });
    }
});

// Get downloaded tracks of a specific user (Downloads tab)
router.get('/author/:userId', async (req, res) => {
    try {
        const midis = await Midi.find({ uploader: req.params.userId })
            .populate('uploader', 'username createdAt')
            .sort({ createdAt: -1 });
        res.json(midis);
    } catch (error) {
        console.error("Error getting authors midis:", error);
        res.status(500).json({ message: 'Error loading authors midis'});
    }
});

// Get tracks that the user liked (Liked tab)
router.get('/liked-by/:userId', async (req, res) => {
    try {
        const midis = await Midi.find({ likedBy: req.params.userId })
            .populate('uploader', 'username createdAt')
            .sort({ createdAt: -1 });
        res.json(midis);
    } catch (error) {
        console.error("Error getting liked midis:", error);
        res.status(500).json({ message: 'Error loading liked midis' });
    }
});

// EDIT OWN TRACK (PUT /api/midi/:id)
router.put('/:id', authMiddleware, upload.fields([
    { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        const userId = req.user.id || req.user.userId || req.user._id;
        if (midi.uploader.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Authorization denied (not the author)' });
        }

        if (req.body.title) {
            if (req.body.title.trim().length > 50) {
                return res.status(400).json({ message: 'Title too long (max 50 chars)' });
            }
            midi.title = req.body.title.trim();
        }

        if (req.body.tags) {
            try {
                midi.tags = JSON.parse(req.body.tags);
            } catch (e) {
                console.error("Error parsing tags during edit:", e);
            }
        }

        const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

        if (coverFile) {
            if (midi.coverImage && midi.coverImage.startsWith('/uploads/covers/')) {
                const oldCoverPath = path.join(__dirname, '..', midi.coverImage);
                if (fs.existsSync(oldCoverPath)) {
                    fs.unlinkSync(oldCoverPath);
                }
            }
            midi.coverImage = `/uploads/covers/${coverFile.filename}`;
        } else if (req.body.coverUrl !== undefined) {
            if (req.body.coverUrl === '') {
                if (midi.coverImage && midi.coverImage.startsWith('/uploads/covers/')) {
                    const oldCoverPath = path.join(__dirname, '..', midi.coverImage);
                    if (fs.existsSync(oldCoverPath)) fs.unlinkSync(oldCoverPath);
                }
                midi.coverImage = null;
            } else {
                midi.coverImage = req.body.coverUrl;
            }
        }

        await midi.save();
        res.json({ message: 'Track updated successfully', midi });
    } catch (error) {
        console.error("Error updating track:", error);
        res.status(500).json({ message: 'Server error during track update' });
    }
});

module.exports = router;
