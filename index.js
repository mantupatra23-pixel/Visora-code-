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

// 🚀 MAIN GOD-MODE CODE GENERATOR API
app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`[🚀 New Build]: ${prompt.substring(0, 50)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "GROQ_API_KEY missing!" });
        }

        // 🔥 THE EXPERT SYSTEM PROMPT (Inspired by your reference) 🔥
        const systemPrompt = `You are an elite, world-class React developer and AI Code Generator (like v0.dev, Cursor, or Mantu AI).
Your sole purpose is to generate flawless, production-ready, beautiful React code based on the user's prompt.

CRITICAL INSTRUCTIONS FOR A PERFECT SINGLE-FILE OUTPUT:
1.  **Strictly Single File:** Combine EVERYTHING into one single code block. Put all sub-components (like Navbar, HeroSection, InputBox) in the same file as the main 'App' component.
2.  **Top-Level Requirements:**
    * Start with: \`import React, { useState, useEffect } from 'react';\` (and any other necessary standard imports like lucide-react icons if you mock them).
    * End with: \`export default App;\` (or \`export default function App() {...}\`).
3.  **Code Quality & Formatting:**
    * Use modern React conventions (Functional components, Hooks).
    * Write clean, readable, well-indented code (2 spaces per indent).
    * Do NOT put all code on one line or format it poorly.
4.  **Styling (Tailwind CSS):**
    * Use Tailwind CSS exclusively for styling.
    * Implement beautiful, modern UI/UX: glassmorphism, smooth hovers, gradients, responsive design (mobile-first), dark/light mode considerations if requested.
5.  **Icons & Images:**
    * If you need icons, create simple inline SVG components at the top of the file (e.g., \`const HomeIcon = () => <svg>...</svg>\`) instead of assuming external libraries are installed.
6.  **ZERO YAPPING:**
    * Output ONLY the raw code.
    * No explanations, no markdown formatting like \`\`\`jsx or \`\`\` at the beginning or end.
    * If you include comments, put them INSIDE the code block as standard JS comments (\`//\` or \`/* */\`).`;

        // We use Llama 3 70B, which is incredibly smart at following complex formatting rules.
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1, // Very low temperature for highly structured, predictable code formatting
        });

        let generatedCode = chatCompletion.choices[0]?.message?.content || "";
        
        // Final safety net to strip ANY markdown that the AI stubbornly includes
        generatedCode = generatedCode.replace(/^```(jsx|tsx|javascript|react|js|ts)?\n?/i, ''); // Strip starting ```
        generatedCode = generatedCode.replace(/\n?```$/i, ''); // Strip ending ```
        generatedCode = generatedCode.trim(); // Clean up extra spaces

        res.json({ success: true, code: generatedCode });

    } catch (error) {
        console.error("Groq Engine Error:", error.message);
        res.json({ success: false, error: `Groq AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Visora AI Expert Engine is Live! 🚀"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
