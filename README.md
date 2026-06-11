# MidiPad - Backend (API)

This is the official Node.js backend API for [midipad.net](https://midipad.net). It handles secure Discord OAuth authentication, file uploads, track metadata, and community interactions (likes, comments, downloads).

Check out the [MidiPad Frontend Repository](https://github.com/LomkaKa1ff/Midipad.git).

## Tech Stack
* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB (Mongoose)
* **Authentication:** Passport.js (Discord OAuth2 strategy) + JWT (JSON Web Tokens)
* **File Handling:** Multer (for secure `.mid` file uploads)
* **Security:** bcrypt (for hashing fallback passwords)

## Requirements
Before you begin, ensure you have met the following requirements:
* **Node.js** (v16.0.0 or higher)
* **MongoDB** (Running locally on default port 27017, or a MongoDB Atlas URI)
* **Discord Developer Account:** You need to create an application in the Discord Developer Portal to get your `CLIENT_ID` and `CLIENT_SECRET` for OAuth to work.

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/LomkaKa1ff/Midipad-backend.git
   cd midipad-backend

2. **Install dependencies:**
   ```bash
   npm install

3. **Environment Variables:**

   Create a .env file in the root directory. Never commit this file.
   ```bash
   PORT=5000
   MONGO_URI=mongodb://localhost:27017/midipad
   JWT_SECRET=your_super_secret_jwt_key_here

   FRONTEND_URL=http://localhost:3000

   # Discord OAuth Credentials
   DISCORD_CLIENT_ID=your_discord_app_id
   DISCORD_CLIENT_SECRET=your_discord_app_secret
   DISCORD_CALLBACK_URL=http://localhost:5000/api/auth/discord/callback

4. **Install dependencies:**
   ```bash
   npm run dev
   # or
   node server.js
   ```
   The server will start on http://localhost:5000.

## License
All rights reserved. This project is proprietary. No one may copy, distribute, or modify the code without the explicit permission of the author.
