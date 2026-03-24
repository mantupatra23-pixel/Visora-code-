const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Main Test Route
app.get('/', (req, res) => {
    res.json({ 
        message: "Visora Code Engine Backend is Live! ⚡", 
        status: "Active",
        version: "1.0.0"
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Visora Backend is running on port ${PORT}`);
});
