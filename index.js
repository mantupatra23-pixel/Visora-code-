const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 🚀 TEENO AI ENGINE IMPORT KIYE HAIN
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Mistral } = require('@mistralai/mistralai');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize APIs
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

app.get('/api/env', (req, res) => {
    res.json({ success: true, variables: { MANTU_AI_STATUS: "30-AGENT TRI-ENGINE SWARM ACTIVE" } });
});

app.post('/api/build', async (req, res) => {
    const { prompt } = req.body;
    console.log(`\n[🚀 Mantu AI 30-Agent Swarm Started]: ${prompt.substring(0, 30)}...`);

    try {
        if (!process.env.GROQ_API_KEY || !process.env.GEMINI_API_KEY || !process.env.MISTRAL_API_KEY) {
            return res.json({ success: false, error: "API Keys missing! Ensure Groq, Gemini, and Mistral keys are in .env" });
        }

        let masterAgentLogs = [];
        let masterFiles = {};

        // ==========================================
        // 🧠 DEPARTMENT 1: GEMINI (Planning - 10 Agents)
        // ==========================================
        console.log(`[1/3] Calling Gemini API (Planning Department)...`);
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const geminiPrompt = `You are the Planning Department of Mantu AI (10 specialized agents).
        Task: "${prompt}"
        Generate exactly 10 agent logs outlining the planning phase (Requirements, Architecture, Database, API mapping, etc.).
        Return ONLY a JSON object with a "logs" array. No markdown.
        Format: { "logs": [ { "agent": "Product Manager", "status": "Defining Scope", "details": "..." }, ... ] }`;

        const geminiResult = await geminiModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: geminiPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        const geminiData = JSON.parse(geminiResult.response.text());
        masterAgentLogs = [...masterAgentLogs, ...geminiData.logs];

        // ==========================================
        // ⚡ DEPARTMENT 2: GROQ (Frontend - 10 Agents)
        // ==========================================
        console.log(`[2/3] Calling Groq API (Frontend Department)...`);
        const groqPrompt = `You are the Frontend Department of Mantu AI (10 specialized agents).
        Task: "${prompt}"
        Generate exactly 10 agent logs for frontend work (UI, UX, Tailwind, State, React Components).
        Also, generate the FULL React code for the frontend files.
        Return ONLY a valid JSON. NO markdown blocks. Code must have actual newlines (\\n).
        Format: {
          "logs": [ { "agent": "UI Designer", "status": "Styling", "details": "..." }, ... ],
          "files": { "src/App.jsx": "import React...", "src/components/Navbar.jsx": "..." }
        }`;

        const groqResult = await groq.chat.completions.create({
            messages: [{ role: 'system', content: groqPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });
        const groqData = JSON.parse(groqResult.choices[0].message.content);
        masterAgentLogs = [...masterAgentLogs, ...groqData.logs];
        masterFiles = { ...masterFiles, ...groqData.files };

        // ==========================================
        // 🛡️ DEPARTMENT 3: MISTRAL (Backend & QA - 10 Agents)
        // ==========================================
        console.log(`[3/3] Calling Mistral API (QA & Security Department)...`);
        const mistralPrompt = `You are the Backend & QA Department of Mantu AI (10 specialized agents).
        Task: "${prompt}"
        Generate exactly 10 agent logs for Backend setup, Code Review, Security Testing, and Optimization.
        Generate the backend config or utility files (e.g., config.js, api.js, tailwind.config.js).
        Return ONLY a valid JSON. NO markdown.
        Format: {
          "logs": [ { "agent": "Security Lead", "status": "Testing", "details": "..." }, ... ],
          "files": { "src/api.js": "export const api...", "tailwind.config.js": "..." }
        }`;

        const mistralResult = await mistral.chat.complete({
            model: 'mistral-large-latest',
            messages: [{ role: 'user', content: mistralPrompt }],
            temperature: 0.1,
            responseFormat: { type: 'json_object' }
        });
        const mistralData = JSON.parse(mistralResult.choices[0].message.content);
        masterAgentLogs = [...masterAgentLogs, ...mistralData.logs];
        masterFiles = { ...masterFiles, ...mistralData.files };

        // ==========================================
        // 🎯 FINAL ASSEMBLY
        // ==========================================
        console.log(`[Swarm Complete] Total Agents Deployed: ${masterAgentLogs.length}. Files created: ${Object.keys(masterFiles).length}`);

        res.json({ 
            success: true, 
            logs: masterAgentLogs, 
            files: masterFiles 
        });

    } catch (error) {
        console.error("Mantu Tri-Engine Error:", error.message);
        res.json({ success: false, error: `Swarm Error: ${error.message}` });
    }
});

app.get('/', (req, res) => res.send("Mantu 30-Agent Tri-Engine Swarm is Live! 🚀"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}...`));
