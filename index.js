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
    console.log(`[🚀 Analyzing Prompt]: ${prompt.substring(0, 50)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY missing!" });
        }

        // 🔥 THE FLAWLESS CODE GENERATOR PROMPT 🔥
        const systemPrompt = `You are an elite AI Code Generator like Cursor or v0.dev.
Your job is to generate a COMPLETE, flawless, production-ready React component.

CRITICAL FORMATTING RULES:
1. LEFT-ALIGNED INDENTATION: You MUST use standard 2-space indentation. NEVER center-align the code. NEVER add massive empty spaces to the left.
2. ZERO MARKDOWN: Do NOT wrap your response in \`\`\`jsx or \`\`\` tags. Return ONLY the raw code string.
3. SINGLE FILE STRUCTURE:
   - Start with \`import React, { useState } from 'react';\`
   - Define custom SVG icons as variables.
   - Define sub-components.
   - End with \`export default function App() { ... }\`
4. TAILWIND CSS: Use Tailwind for all styling (dark mode, glassmorphism, gradients).
5. NO YAPPING: Absolutely no conversational text or explanations. Code only.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1, // Fixed syntax and formatting requires low temperature
        });

        let generatedCode = chatCompletion.choices[0]?.message?.content || "";

        // Final Markdown Strip
        generatedCode = generatedCode.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Visora Flawless Code Engine Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
