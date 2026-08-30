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

    if (!contents) return res.status(400).json({ error: 'Missing "contents" in request body.' });
    
    const geminiResponse = await axios.post(API_URL, { contents });
    const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (responseText) res.json({ text: responseText });
    else res.status(500).json({ error: 'Received an empty or invalid response.' });
  } catch (error) {
    console.error("Error calling Gemini API:", error.message);
    res.status(500).json({ error: 'Failed to fetch response.' });
  }
});

// ---------------------------------------------------------
// NEW AI MOCK TEST ENGINE (CHUNKED & DIAGRAM PROXY FIX)
// ---------------------------------------------------------
const activeTestsCache = {}; 

// Route A: Generate the test in chunks
app.post('/api/generate-chunk', async (req, res) => {
    try {
        const { examType, syllabusType, subject, topic, numQuestionsToGenerate, sessionId, startIndex } = req.body;

        const scope = syllabusType === "Full Syllabus" 
            ? `the full syllabus of ${subject} for ${examType}` 
            : `the specific topic '${topic}' in ${subject} for ${examType}`;

        const prompt = `
        You are an expert NTA paper setter for ${examType}. 
        Generate exactly ${numQuestionsToGenerate} highly accurate questions for ${scope}. (Questions ${startIndex} onwards).
        
        CRITICAL RULES:
        1. Output ONLY a raw JSON array.
        2. DIAGRAMS (CRUCIAL): Include diagrams for at least 30% of the questions (e.g., logic gates, circuits, free body diagrams, biology cells, graphs).
           - Use your Search capability to find a REAL, WORKING image URL from educational websites that perfectly matches the question.
           - Provide ONLY the raw URL string in the "imageUrl" field (e.g., "https://example.com/image.png").
           - If no diagram is needed, leave "imageUrl" as "".
        3. Use LaTeX for math/physics formulas (wrap inline in $...$, block in $$...$$).
        
        Format each object exactly like this:
        {
          "questionId": "unique_string_id",
          "text": "Question text here",
          "imageUrl": "https://...",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 0, 
          "solution": "Step-by-step detailed solution here"
        }
        `;

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await axios.post(API_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }], // Unlocks actual web search for diagrams
            generationConfig: { responseMimeType: "application/json" } // Forces pure JSON
        });

        const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error("Empty response from AI");

        const generatedQuestions = JSON.parse(responseText);
        let currentSessionId = sessionId;
        
        // Setup cache if first chunk
        if (!currentSessionId || !activeTestsCache[currentSessionId]) {
            currentSessionId = crypto.randomUUID();
            activeTestsCache[currentSessionId] = { questions: [], expiresAt: Date.now() + (5 * 60 * 60 * 1000) };
        }

        // Add questions to server memory
        activeTestsCache[currentSessionId].questions.push(...generatedQuestions);

        // Strip correct answers before sending to frontend
        const secureQuestions = generatedQuestions.map(q => ({
            questionId: q.questionId,
            text: q.text,
            imageUrl: q.imageUrl,
            options: q.options
        }));

        res.json({ testSessionId: currentSessionId, newQuestions: secureQuestions });

    } catch (error) {
        console.error("Backend Error generating chunk:", error.message);
        res.status(500).json({ error: "Failed to generate chunk." });
    }
});

// Route B: Evaluate the Test
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
        else if (selectedOption !== null) score -= 1; // Negative marking

        detailedAnalysis.push({
            questionText: actualQuestion.text,
            imageUrl: actualQuestion.imageUrl,
            options: actualQuestion.options,
            userAnswer: selectedOption,
            correctAnswer: actualQuestion.correctOptionIndex,
            isCorrect: isCorrect,
            solution: actualQuestion.solution
        });
    });

    delete activeTestsCache[testSessionId]; // Free RAM
    res.json({ score, totalMarks, detailedAnalysis });
});

// ---------------------------------------------------------
// START SERVER
// ---------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running successfully on port ${PORT}`);
});
