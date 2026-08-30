// server.js

// 1. Import necessary libraries
const express = require('express');
const axios = require('axios');
const crypto = require('crypto'); // Built-in Node module for generating unique IDs
require('dotenv').config(); 

// 2. Initialize Express app and set port
const app = express();
const PORT = process.env.PORT || 3000;

// 3. Middleware setup
app.use(express.static('public')); 
app.use(express.json({ limit: '10mb' })); 

// 4. Securely get the API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not defined.");
  process.exit(1);
}

// ---------------------------------------------------------
// ORIGINAL AI DOUBT SOLVER ROUTE
// ---------------------------------------------------------
app.post('/api/solve', async (req, res) => {
  try {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const { contents } = req.body;

    if (!contents) {
      return res.status(400).json({ error: 'Missing "contents" in request body.' });
    }
    
    const geminiResponse = await axios.post(API_URL, { contents });
    const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (responseText) {
      res.json({ text: responseText });
    } else {
      res.status(500).json({ error: 'Received an empty or invalid response.' });
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error.message);
    res.status(500).json({ error: 'Failed to fetch response.' });
  }
});


// ---------------------------------------------------------
// NEW AI MOCK TEST ENGINE (CHUNKED)
// ---------------------------------------------------------

// In-memory cache. Declared ONLY ONCE here.
const activeTestsCache = {}; 

// A. Route to generate the test in chunks
app.post('/api/generate-chunk', async (req, res) => {
    try {
        const { examType, syllabusType, subject, topic, numQuestionsToGenerate, sessionId, startIndex } = req.body;

        const scope = syllabusType === "Full Syllabus" 
            ? `the full syllabus of ${subject} for ${examType}` 
            : `the specific topic '${topic}' in ${subject} for ${examType}`;

        const prompt = `
        You are an expert NTA paper setter for ${examType}. Tap into your deep knowledge of past year ${examType} papers.
        Generate exactly ${numQuestionsToGenerate} highly accurate questions for ${scope}. (These are questions ${startIndex} onwards).
        
        CRITICAL RULES:
        1. Output ONLY a raw JSON array.
        2. Use LaTeX for math/physics/chemistry formulas (wrap inline in $...$, block in $$...$$).
        3. DIAGRAMS: You MUST include diagrams for at least 2 out of these ${numQuestionsToGenerate} questions. 
           - Output beautiful, well-proportioned raw SVG code in the "diagramSvg" field. 
           - SVG RULES: Always include a viewBox (e.g., viewBox="0 0 300 300"). Use stroke="black", fill="transparent", and make text labels large (font-size="16"). 
           - If no diagram is needed, leave as "".
        
        Format each object exactly like this:
        {
          "questionId": "unique_string_id",
          "text": "Question text here",
          "diagramSvg": "<svg viewBox='...'>...</svg>",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 0, 
          "solution": "Step-by-step detailed solution here"
        }
        `;

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await axios.post(API_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error("Empty response from AI");

        const generatedQuestions = JSON.parse(responseText);
        let currentSessionId = sessionId;
        
        // If first chunk, create session
        if (!currentSessionId || !activeTestsCache[currentSessionId]) {
            currentSessionId = crypto.randomUUID();
            activeTestsCache[currentSessionId] = {
                questions: [],
                expiresAt: Date.now() + (5 * 60 * 60 * 1000)
            };
        }

        // Append new questions
        activeTestsCache[currentSessionId].questions.push(...generatedQuestions);

        // Secure version for frontend
        const secureQuestions = generatedQuestions.map(q => ({
            questionId: q.questionId,
            text: q.text,
            diagramSvg: q.diagramSvg,
            options: q.options
        }));

        res.json({ testSessionId: currentSessionId, newQuestions: secureQuestions });

    } catch (error) {
        console.error("Backend Error generating chunk:", error.message);
        res.status(500).json({ error: "Failed to generate chunk." });
    }
});

// B. Route to evaluate the test
app.post('/api/evaluate-test', (req, res) => {
    const { testSessionId, userResponses } = req.body;
    const testSession = activeTestsCache[testSessionId];

    if (!testSession) return res.status(400).json({ error: "Test session expired or invalid." });

    let score = 0;
    const totalMarks = testSession.questions.length * 4; 
    const detailedAnalysis = [];

    testSession.questions.forEach((actualQuestion) => {
        const userResponse = userResponses.find(ur => ur.questionId === actualQuestion.questionId);
        const selectedOption = userResponse ? userResponse.selectedOptionIndex : null;
        
        const isCorrect = selectedOption === actualQuestion.correctOptionIndex;
        if (isCorrect) score += 4;
        else if (selectedOption !== null) score -= 1;

        detailedAnalysis.push({
            questionText: actualQuestion.text,
            diagramSvg: actualQuestion.diagramSvg,
            options: actualQuestion.options,
            userAnswer: selectedOption,
            correctAnswer: actualQuestion.correctOptionIndex,
            isCorrect: isCorrect,
            solution: actualQuestion.solution
        });
    });

    delete activeTestsCache[testSessionId]; // Clean up RAM
    res.json({ score, totalMarks, detailedAnalysis });
});

// ---------------------------------------------------------
// START SERVER
// ---------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running successfully on port ${PORT}`);
});
