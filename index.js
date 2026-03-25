const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`[🚀 Mantu AI Analyzing]: ${prompt.substring(0, 50)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY missing!" });
        }

        // 🔥 THE ULTIMATE STRICT PROMPT 🔥
        const systemPrompt = `You are Mantu AI, an elite React developer.
Your ONLY job is to output a SINGLE, fully functional React component file.

CRITICAL RULES (IF YOU BREAK THESE, THE APP CRASHES):
1. NO MARKDOWN: NEVER output \`\`\`jsx or \`\`\` tags. NEVER. Output ONLY plain text code.
2. SINGLE FILE ONLY: Combine ALL components, icons, and logic into ONE single file. DO NOT split into multiple files.
3. STRUCTURE:
   - Always start with: import React, { useState, useEffect } from 'react';
   - Define all custom SVG icons next.
   - Define all sub-components.
   - End with: export default function App() { ... }
4. INDENTATION: Use standard 2-space indentation. Keep it clean.
5. NO YAPPING: Absolutely no conversational text.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1, 
        });

        let generatedCode = chatCompletion.choices[0]?.message?.content || "";
        
        // 🔥 AGGRESSIVE CLEANUP: Remove ANY trace of markdown 🔥
        generatedCode = generatedCode.replace(/```(jsx|tsx|javascript|js|react)?/gi, ''); 
        generatedCode = generatedCode.replace(/```/g, '');
        generatedCode = generatedCode.trim();

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Mantu AI Backend is Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
