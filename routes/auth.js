const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const router = express.Router();

// --- НАСТРОЙКА СТРАТЕГИИ DISCORD ---
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // 1. Ищем пользователя по email
        let user = await User.findOne({ email: profile.email });

        // 2. Если нет — регистрируем нового
        if (!user) {
            user = new User({
                username: profile.username,
                email: profile.email,
                // Генерируем случайный пароль, так как юзер вошел через Discord
                password: Math.random().toString(36).slice(-10) + 'A1!'
            });
            await user.save();
        }
        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

// Технические функции для сохранения юзера в сессии
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));


// --- САМИ РОУТЫ ---

// 1. Сюда юзер попадает при клике на кнопку (отправляем в Дискорд)
router.get('/discord', passport.authenticate('discord'));

// 2. Сюда Дискорд возвращает юзера после успешного входа
router.get('/discord/callback', passport.authenticate('discord', {
    failureRedirect: 'http://localhost:3000/login'
}), (req, res) => {
    // Генерируем токен, как при обычном логине
    const token = jwt.sign(
        { id: req.user._id },
        process.env.JWT_SECRET || 'secret123',
        { expiresIn: '7d' }
    );

    // Подготавливаем данные юзера
    const userData = {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email
    };

    // Перенаправляем обратно на фронтенд, передавая токен в URL
    const frontendRedirectUrl = `http://localhost:3000/login?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`;
    res.redirect(frontendRedirectUrl);
});

router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // 1. Проверяем, нет ли уже такого юзера
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email or username already exists' });
        }

        // 2. Шифруем пароль
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Создаем и сохраняем юзера
        const newUser = new User({
            username,
            email,
            password: hashedPassword
        });
        await newUser.save();

        res.status(201).json({ message: 'User successfully registered' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during registration' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Ищем юзера по email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // 2. Сравниваем пароли
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // 3. Создаем токен (пропуск)
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' } // Токен живет 7 дней
        );

        // 4. Отправляем инфу на фронтенд
        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

module.exports = router;