const mongoose = require('mongoose');

const midiSchema = new mongoose.Schema({
    title: { type: String, required: true },
    filename: { type: String, required: true }, // Имя файла на диске сервера
    originalName: { type: String, required: true }, // Как файл назывался у юзера
    size: { type: Number, required: true }, // Вес файла в байтах
    uploader: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Ссылка на создателя
        required: true
    },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    listens: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    downloadedByIps: [{ type: String }],
    comments: [
        {
            text: { type: String, required: true },
            username: { type: String, required: true },
            userId: { type: String, required: true },
            createdAt: { type: Date, default: Date.now }
        }
    ],
    tags: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Midi', midiSchema);