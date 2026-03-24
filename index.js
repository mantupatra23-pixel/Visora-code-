const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/build', async (req, res) => {
    try {
        const { prompt } = req.body;
        console.log(`New prompt received: ${prompt}`);

        // CHECK 1: Kya API Key Render par set hai?
        if (!process.env.GEMINI_API_KEY) {
            return res.json({ 
                success: false, 
                error: "API Key missing! Render ke Environment tab mein GEMINI_API_KEY set karo." 
            });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // CHECK 2: Sabse stable model use kar rahe hain
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemPrompt = `You are an expert React developer. Write ONLY valid JSX code for the requested app. No markdown, no explanations, no html tags.`;
        const finalPrompt = `${systemPrompt}\n\nUser Request: ${prompt}`;

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();

        res.json({ success: true, code: text });

    } catch (error) {
        console.error("AI Engine Error:", error.message);
        // Asli error seedha frontend par bhejenge!
        res.json({ success: false, error: `Google AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => {
    res.send("Backend is Live!");
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running...");
});
