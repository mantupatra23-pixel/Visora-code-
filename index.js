const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. GROQ AI SETUP ---
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// --- 2. NEW ENDPOINT: REAL ENV VARIABLES (Masked for safety) ---
// Ye route aapke Frontend ke "Env" button ko chalayega
app.get('/api/env', (req, res) => {
    const maskedVars = {};
    Object.keys(process.env).forEach(key => {
        const value = process.env[key];
        // Sirf zaroori details bhejenge, wo bhi aadhi chupa kar (security ke liye)
        if (key.includes('KEY') || key.includes('PORT') || key.includes('URL') || key.includes('ENV')) {
            maskedVars[key] = value ? `${value.substring(0, 4)}•••••••• (Masked)` : 'NOT DEFINED';
        }
    });
    res.json({ success: true, variables: maskedVars });
});

// --- 3. MAIN AI CODE GENERATION ENDPOINT ---
app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`[🚀 New Build Request]: ${prompt.substring(0, 50)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY missing! Render par add karo." });
        }

        // AI ko strict instruction: "Sirf code do, markdown ya baatein nahi"
        const systemPrompt = `You are an expert React developer. Write ONLY valid React JSX code for the requested app. 
        CRITICAL: Do NOT wrap the code in markdown blocks (like \`\`\`jsx). Do NOT include any explanations. Just return the raw code string.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile', // Sabse fast aur naya model
            temperature: 0.3,
        });

        let generatedCode = chatCompletion.choices[0]?.message?.content || "";
        
        // Agar AI galti se markdown (```jsx) laga de, toh usko saaf karne ka jugaad:
        generatedCode = generatedCode.replace(/^```jsx\n|^```javascript\n|^```\n/i, '').replace(/\n```$/i, '');

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Engine Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

// --- 4. SERVER STATUS ROUTE ---
app.get('/', (req, res) => res.send("Visora AI Engine (Powered by Groq) is Live! 🚀"));

// --- 5. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
