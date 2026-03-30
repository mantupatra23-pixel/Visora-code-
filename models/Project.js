// models/Project.js
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    userId: {
        type: String,
        default: "guest_user", // Baad mein yahan Google Login/Auth ka ID aayega
    },
    title: {
        type: String,
        required: true,
        default: "Untitled Mantu App"
    },
    files: {
        type: Object, // Pura React code JSON format (Object) mein save hoga
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Project', projectSchema);
