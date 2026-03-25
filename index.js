const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Groq AI
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`New prompt received: ${prompt}`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({
                success: false,
                error: "GROQ_API_KEY missing! Render par set karo." 
            });
        }

        const systemPrompt = `You are an expert React developer. Write ONLY valid JSX code for the requested app. No markdown, no explanations, no html tags. Just the raw code.`;

        // Groq API Call (Using LLaMA 3 70B - Very fast & smart for coding)
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.5,
        });

        const generatedCode = chatCompletion.choices[0]?.message?.content || "";

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Engine Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Groq AI Backend is Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
