const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// REAL ENV VARIABLES
app.get('/api/env', (req, res) => {
    const maskedVars = {};
    Object.keys(process.env).forEach(key => {
        const value = process.env[key];
        if (key.includes('KEY') || key.includes('PORT') || key.includes('URL') || key.includes('ENV')) {
            maskedVars[key] = value ? `${value.substring(0, 4)}•••••••• (Masked)` : 'NOT DEFINED';
        }
    });
    res.json({ success: true, variables: maskedVars });
});

// MAIN FULL-CODE GENERATOR API
app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`[🚀 New Build]: ${prompt.substring(0, 50)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY missing!" });
        }

        // 🔥 YAHAN HAI ASLI JADU - GOD-MODE SYSTEM PROMPT 🔥
        const systemPrompt = `You are a world-class Full-Stack Developer and AI Code Generator (like v0.dev or Cursor).
        Your job is to generate COMPLETE, production-ready, fully working React+Tailwind applications based on the user's request.
        
        CRITICAL RULES:
        1. ALWAYS include standard imports at the very top (e.g., \`import React, { useState, useEffect } from 'react';\`).
        2. ALWAYS export the main component as default (e.g., \`export default function App() { ... }\`).
        3. Do NOT give code fragments. The code MUST be a fully valid, standalone file ready to run.
        4. Include all necessary sub-components within the same file if needed.
        5. Use Tailwind CSS classes for all styling. Make it beautiful, modern, and responsive.
        6. DO NOT wrap the output in markdown code blocks like \`\`\`jsx or \`\`\`. Return ONLY the raw code text.
        7. DO NOT include any conversational text, explanations, or notes. Output ONLY code.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2, // Thoda kam kiya taaki code zyada accurate aur stable rahe
        });

        let generatedCode = chatCompletion.choices[0]?.message?.content || "";
        
        // Safety filter to remove accidental markdown tags
        generatedCode = generatedCode.replace(/^```jsx\n|^```javascript\n|^```react\n|^```\n/i, '').replace(/\n```$/i, '');

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Engine Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Visora Full-Stack AI Engine is Live! 🚀"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
