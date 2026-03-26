const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 🔥 SIRF GROQ IMPORT KIYA HAI (Baaki sab hata diya) 🔥
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "30-AGENT GROQ SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Groq Master Swarm Initiated]: ${prompt.substring(0, 30)}...`);

    try {
        if (!process.env.GROQ_API_KEY) {
            return res.json({ success: false, error: "Groq API Key is missing in Render!" });
        }

        // 🧠 THE MASTER SWARM PROMPT (Groq akela 30 agents banega)
        const systemPrompt = `You are Mantu AI, a massive swarm of 30 specialized AI agents (Lead Architects, UI/UX Designers, React Developers, Security Experts, QA Testers).
        Task: "${prompt}"
        
        Simulate the workflow of these 30 agents collaborating. 
        1. Generate exactly 15 detailed agent logs representing different departments analyzing, planning, designing, and coding.
        2. Generate the FULL React code for all necessary files (App.jsx, Components, Tailwind Config).
        
        ⚠️ CRITICAL CODING RULES ⚠️
        1. DO NOT MINIFY THE CODE! Every import, HTML tag, and logic block MUST be on a new line.
        2. Use proper newline characters ('\\n') in the JSON string.
        3. Return ONLY a valid JSON object. NO markdown formatting.
        
        Format: {
          "logs": [
            { "agent": "Lead Architect", "status": "Planning", "details": "Designed system..." },
            { "agent": "UI Designer", "status": "Styling", "details": "Applied Tailwind..." },
            { "agent": "Senior React Dev", "status": "Coding", "details": "Wrote logic..." }
          ],
          "files": {
            "src/App.jsx": "import React from 'react';\\n\\nexport default function App() {\\n  return <div>Hello</div>;\\n}",
            "tailwind.config.js": "module.exports = {\\n  content: []\\n}"
          }
        }`;

        const groqResult = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const data = JSON.parse(groqResult.choices[0].message.content);
        
        console.log(`[Swarm Complete] Logs generated: ${data.logs?.length}. Files created: ${Object.keys(data.files || {}).length}`);

        res.json({ 
            success: true, 
            logs: data.logs || [], 
            files: data.files || {} 
        });

    } catch (error) {
        console.error("Groq Error:", error.message);
        res.json({ success: false, error: `Groq Swarm Error: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
