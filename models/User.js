// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Encrypted password
    plan: { type: String, default: "free" }, // 'free', 'pro', 'agency'
    credits: { type: Number, default: 10 }, // New users get 10 free AI generations
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
