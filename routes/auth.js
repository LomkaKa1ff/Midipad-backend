const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Midi = require('../models/Midi');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// DISCORD STRATEGY SETUP
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // 1. Finding user by email
        let user = await User.findOne({ email: profile.email });

        // 2. If not found - register new user
        if (!user) {
            user = new User({
                username: profile.username,
                email: profile.email,
                // Generating a random password since the user logged in via Discord
                password: Math.random().toString(36).slice(-10) + 'A1!'
            });
            await user.save();
        }
        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

// Technical functions to save user in session
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));


// AUTH ROUTES

// 1. User hits this route on button click (Redirects to Discord)
router.get('/discord', passport.authenticate('discord'));

// 2. Discord returns the user here after successful login
router.get('/discord/callback', (req, res, next) => {
    passport.authenticate('discord', { session: false }, (err, user, info) => {
        if (err) {
            console.log("Discord rejected the token");
            if (err.oauthError && err.oauthError.data) {
                console.log(err.oauthError.data);
            } else {
                console.log(err);
            }
            return res.status(500).send("Error Discord OAuth.");
        }

        if (!user) {
            return res.redirect(`${FRONTEND_URL}/login`);
        }

        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const userData = {
            id: user._id,
            username: user.username,
            email: user.email
        };

        const frontendRedirectUrl = `${FRONTEND_URL}/login?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`;
        res.redirect(frontendRedirectUrl);
    })(req, res, next);
});

router.post('/register', async (req, res) => {
    try {
        const { username, email, password, captchaToken } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ message: 'Captcha verification is required' });
        }

        const secretKey = process.env.CAPTCHA_SECRET_KEY
        const formData = new URLSearchParams();
        formData.append('secret', secretKey);
        formData.append('response', captchaToken);

        const cfResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData
        });
        const cfData = await cfResponse.json();

        if (!cfData.success) {
            return res.status(400).json({ message: 'Captcha verification failed. Are you a bot?' });
        }

        // 1. Check if such a user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email or username already exists' });
        }

        // 2. Password encryption
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Creating and saving user
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
        const { email, password, captchaToken } = req.body;

        if (!captchaToken) {
            return res.status(400).json({ message: 'Captcha verification is required' });
        }

        const secretKey = process.env.CAPTCHA_SECRET_KEY;
        const formData = new URLSearchParams();
        formData.append('secret', secretKey);
        formData.append('response', captchaToken);

        const cfResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData
        });
        const cfData = await cfResponse.json();

        if (!cfData.success) {
            return res.status(400).json({ message: 'Captcha verification failed. Are you a bot?' });
        }

        // 1. Finding user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // 2. Checking passwords
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // 3. Creating token (7 days :D)
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // 4. Sending information to frontend
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

// Get user profile
router.get('/user/:id', async (req, res) => {
    try {
        // Finding user
        const user = await User.findById(req.params.id).select('username avatar createdAt');
        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
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
        console.error("Error while getting author midis:", error);
        res.status(500).json({ message: 'Error while loading author midis' });
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
        console.error("Error getting liked midi:", error);
        res.status(500).json({ message: 'Error loading liked tracks' });
    }
});

module.exports = router;