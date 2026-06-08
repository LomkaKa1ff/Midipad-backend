const express = require('express');
const multer = require('multer');
const path = require('path');
const Midi = require('../models/Midi');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const router = express.Router();

// 1. Простенький Middleware для проверки токена (чтобы анонимы не грузили файлы)
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Убедись, что ключ совпадает с тем, что в auth.js
        req.user = decoded; // Кладем данные юзера в запрос
        next();
    } catch (err) {
        res.status(400).json({ message: 'Token is not valid' });
    }
};

// 2. Настраиваем Multer (где и как сохранять файлы)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Папка, куда будут падать файлы
    },
    filename: (req, file, cb) => {
        // Делаем уникальное имя, чтобы файлы с одинаковым названием не перезаписали друг друга
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 1048576 } // Защита на бэкенде: макс 1 МБ
});

// 3. РОУТ ЗАГРУЗКИ (POST /api/midi/upload)
router.post('/upload', authMiddleware, upload.single('midiFile'), async (req, res) => {
    try {
        if (!req.file) {
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

        // Создаем запись в базе данных
        const newMidi = new Midi({
            title: req.body.title,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            // Теперь бэкенд найдет твой ID, как бы он ни назывался в токене:
            uploader: req.user.id || req.user.userId || req.user._id,
            tags: parsedTags
        });

        await newMidi.save();

        res.status(201).json({ message: 'File uploaded successfully!', midi: newMidi });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during upload' });
    }
});

// РОУТ ПОЛУЧЕНИЯ ТРЕКОВ (С поддержкой сортировки и ПОИСКА)
router.get('/', async (req, res) => {
    try {
        const { sort, search } = req.query;

        let query = {};
        let sortObj = { createdAt: -1 };

        // 1. ЛОГИКА ПОИСКА (Если есть параметр search, ищем по названию)
        if (search) {
            // $regex и $options: 'i' делают поиск регистронезависимым (Mario === mario)
            query.title = { $regex: search, $options: 'i' };
        }

        // 2. ЛОГИКА СОРТИРОВКИ
        if (sort === 'popular') {
            sortObj = { downloads: -1, likes: -1 };
        }
        else if (sort === 'trending') {
            const fourteenDaysAgo = new Date();
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

            // Если поиск уже добавил условие по title, мы просто ДОБАВЛЯЕМ условие по дате
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

// 5. РОУТ ДЛЯ СКАЧИВАНИЯ ФАЙЛА С ПРАВИЛЬНЫМ ИМЕНЕМ (GET /api/midi/download/:id)
router.get('/download/:id', async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) {
            return res.status(404).json({ message: 'MIDI file not found in DB' });
        }

        const filePath = path.join(__dirname, '../uploads', midi.filename);

        // Берем красивое название с сайта
        let downloadName = midi.title;

        // На всякий случай проверяем, есть ли уже расширение. Если нет — добавляем.
        if (!downloadName.toLowerCase().endsWith('.mid') && !downloadName.toLowerCase().endsWith('.midi')) {
            downloadName += '.mid';
        }

        // Отдаем файл с новым красивым именем
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

// 1. Увеличить прослушивания (вызывается в useEffect плеера)
router.post('/listen/:id', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // $addToSet добавляет IP только если его нет,
        // $inc увеличивает listens только если $addToSet реально что-то добавил
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

// 2. Лайк (простой инкремент)
router.post('/like/:id', authMiddleware, async (req, res) => {
    try {
        const userId = (req.user.id || req.user.userId || req.user._id).toString();
        const midi = await Midi.findById(req.params.id);

        if (!midi) return res.status(404).json({ message: 'Track not found' });

        if (!midi.likedBy) midi.likedBy = [];

        // СТРОГОЕ СРАВНЕНИЕ СТРОК
        const isLiked = midi.likedBy.some(id => id.toString() === userId);

        if (isLiked) {
            // Удаляем ID пользователя из массива
            midi.likedBy = midi.likedBy.filter(id => id.toString() !== userId);
            midi.likes = Math.max(0, midi.likes - 1);
        } else {
            // Добавляем ID пользователя
            midi.likedBy.push(userId);
            midi.likes += 1;
        }

        await midi.save();
        res.json({ likes: midi.likes, isLiked: !isLiked });
    } catch (err) {
        console.error("Ошибка лайка:", err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Увеличить скачивания
router.post('/download-increment/:id', async (req, res) => {
    try {
        // Получаем IP пользователя
        // Если используешь Nginx/Heroku, нужно включить app.set('trust proxy', 1) в server.js
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // Обновляем только если IP еще не было в списке
        // $addToSet: добавляет элемент в массив, только если его там нет
        // $inc: увеличивает downloads на 1, ТОЛЬКО если $addToSet реально что-то добавил
        const result = await Midi.updateOne(
            { _id: req.params.id, downloadedByIps: { $ne: ip } },
            {
                $inc: { downloads: 1 },
                $push: { downloadedByIps: ip }
            }
        );

        // Получаем актуальное количество, чтобы вернуть на фронт
        const midi = await Midi.findById(req.params.id);
        res.json({ downloads: midi.downloads });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1. ПОЛУЧИТЬ ЗАГРУЖЕННЫЕ ПОЛЬЗОВАТЕЛЕМ ТРЕКИ
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

// 2. ПОЛУЧИТЬ ЛАЙКНУТЫЕ ПОЛЬЗОВАТЕЛЕМ ТРЕКИ
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

// ПОЛУЧИТЬ ОДИН ТРЕК (Для страницы шеринга)
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

// ДОБАВИТЬ КОММЕНТАРИЙ К ТРЕКУ
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

        await midi.save(); // Теперь Mongoose не вырежет комментарий!

        res.status(201).json(midi);
    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ message: 'Server error adding comment' });
    }
});

// УДАЛИТЬ СВОЙ КОММЕНТАРИЙ (DELETE /api/midi/:id/comment/:commentId)
router.delete('/:id/comment/:commentId', authMiddleware, async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        // Находим индекс комментария в массиве
        const commentIndex = midi.comments.findIndex(c => c._id.toString() === req.params.commentId);

        if (commentIndex === -1) return res.status(404).json({ message: 'Comment not found' });

        // Проверяем, является ли пользователь автором комментария
        const userId = req.user.id || req.user.userId || req.user._id;
        if (midi.comments[commentIndex].userId.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Authorization denied (not the author)' });
        }

        // Удаляем комментарий из массива с помощью splice
        midi.comments.splice(commentIndex, 1);
        await midi.save();

        // Возвращаем измененный трек
        res.json(midi);
    } catch (error) {
        console.error("Error deleting comment:", error);
        res.status(500).json({ message: 'Server error deleting comment' });
    }
});

// УДАЛИТЬ СВОЙ ТРЕК (DELETE /api/midi/:id)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const midi = await Midi.findById(req.params.id);
        if (!midi) return res.status(404).json({ message: 'Track not found' });

        // 1. Проверяем, является ли пользователь автором этого трека
        const userId = req.user.id || req.user.userId || req.user._id;
        if (midi.uploader.toString() !== userId.toString()) {
            return res.status(403).json({ message: 'Authorization denied (not the author)' });
        }

        // 2. Физически удаляем файл из папки uploads
        const filePath = path.join(__dirname, '..', 'uploads', midi.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); // Удаляет файл с диска
        }

        // 3. Удаляем документ из базы данных MongoDB
        await Midi.findByIdAndDelete(req.params.id);

        res.json({ message: 'Track deleted successfully' });
    } catch (error) {
        console.error("Error deleting track:", error);
        res.status(500).json({ message: 'Server error deleting track' });
    }
});

// ПОИСК ТРЕКОВ ПО ТЕГУ (GET /api/midi/tag/:tag)
router.get('/tag/:tag', async (req, res) => {
    try {
        const tagToSearch = req.params.tag.toLowerCase(); // Приводим к нижнему регистру для надежности

        // Ищем все треки, у которых в массиве tags есть нужное слово
        const midis = await Midi.find({ tags: tagToSearch })
            .populate('uploader', 'username')
            .sort({ createdAt: -1 }); // Свежие сверху

        res.json(midis);
    } catch (error) {
        console.error("Error fetching by tag:", error);
        res.status(500).json({ message: 'Server error fetching tags' });
    }
});

module.exports = router;