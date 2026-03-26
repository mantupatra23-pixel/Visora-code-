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
        if (key.includes('KEY') || key.includes('PORT') || key.includes('URL')) {
            maskedVars[key] = value ? `${value.substring(0, 4)}••••••••` : 'NOT DEFINED';
        }
    });
    res.json({ success: true, variables: maskedVars });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Mantu AI Swarm Initiated]: ${prompt.substring(0, 30)}...`);

    try {
        if (!process.env.GROQ_API_KEY) return res.json({ success: false, error: "API Key missing!" });

        // 🔥 THE 5-AGENT SWARM PROMPT 🔥
        const systemPrompt = `You are the Mantu AI Swarm, an elite team of 5 software engineering agents working together to build a React application.
        The user's request is: "${prompt}"

        You must simulate the thought process of 5 different agents and then output the final code.
        
        AGENT ROLES:
        1. Requirements Analyst: Breaks down the core features.
        2. System Architect: Decides the file structure and component breakdown.
        3. UI/UX Designer: Decides on the Tailwind CSS theme, colors, and layout.
        4. State Manager: Plans React hooks (useState, useEffect) and data flow.
        5. Senior Developer: Writes the final flawless code file-by-file.

        CRITICAL: Return ONLY a valid JSON object. Do not wrap in markdown (no \`\`\`json).
        
        JSON STRUCTURE REQUIRED:
        {
          "agent_logs": [
            { "agent": "Requirements Analyst", "status": "Analyzed request...", "details": "Detailed 2-3 sentence explanation of features." },
            { "agent": "System Architect", "status": "Designed Architecture...", "details": "Detailed explanation of files created." },
            { "agent": "UI/UX Designer", "status": "Finalized Design System...", "details": "Explanation of Tailwind classes and colors used." },
            { "agent": "State Manager", "status": "Planned Data Flow...", "details": "Explanation of hooks used." },
            { "agent": "Senior Developer", "status": "Code Generation Complete", "details": "Successfully generated all files." }
          ],
          "files": {
            "src/App.jsx": "import React from 'react';\\n// FULL CODE HERE",
            "src/components/AnyOtherFile.jsx": "// FULL CODE HERE"
          }
        }`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        // Parse the massive JSON from our 5 agents
        const resultJSON = JSON.parse(completion.choices[0].message.content);
        console.log(`[Swarm Complete] Generated ${Object.keys(resultJSON.files || {}).length} files.`);

        res.json({ 
            success: true, 
            logs: resultJSON.agent_logs,
            files: resultJSON.files 
        });

    } catch (error) {
        console.error("Mantu Engine Error:", error.message);
        res.json({ success: false, error: `AI Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Mantu 5-Agent Swarm Backend Live! 🚀"));
app.listen(process.env.PORT || 3000, () => console.log("Server running..."));
