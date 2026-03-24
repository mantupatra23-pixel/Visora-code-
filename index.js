const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Main AI Generation API
app.post('/api/build', async (req, res) => {
    try {
        const { prompt } = req.body;
        console.log(`New build request received: ${prompt}`);

        // Model select karna (Flash fast hota hai coding ke liye)
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // System Prompt: AI ko batana ki use kya karna hai
        const systemPrompt = `You are Visora Code Agent, an expert React developer. 
        Write a complete, working React App component based on the user's request. 
        Return ONLY valid React JSX code. No markdown formatting, no explanations, no HTML tags.`;

        const finalPrompt = `${systemPrompt}\n\nUser Request: ${prompt}`;

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const generatedCode = response.text();

        res.json({
            success: true,
            code: generatedCode
        });

    } catch (error) {
        console.error("AI Engine Error:", error);
        res.status(500).json({ success: false, error: "Failed to generate code." });
    }
});

// Test Route
app.get('/', (req, res) => {
    res.json({ message: "Visora Code AI Engine is Live! 🧠⚡", status: "Active" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Visora AI Backend is running on port ${PORT}`);
});
