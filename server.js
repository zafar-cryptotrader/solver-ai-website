// server.js

// 1. Import necessary libraries
const express = require('express');
const axios = require('axios');
require('dotenv').config(); // Loads environment variables from .env file

// 2. Initialize Express app and set port
const app = express();
const PORT = process.env.PORT || 3000; // Use port from .env or default to 3000

// 3. Middleware setup
// This serves all static files (like index.html) from the 'public' directory
app.use(express.static('public')); 
// This allows the server to understand and parse JSON from the request body
app.use(express.json({ limit: '10mb' })); // Increased limit for image data

// 4. Securely get the API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Check if the API key is available. If not, the server can't work.
if (!GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not defined in the .env file.");
  process.exit(1); // Exit the process with an error code
}

// 5. Define the API proxy endpoint
// The frontend will send requests to '/api/solve'
app.post('/api/solve', async (req, res) => {
  try {
    // Construct the correct Google Gemini API URL
    // Using a powerful model like gemini-1.5-pro is recommended for multi-modal inputs
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    // Get the 'contents' payload sent from the frontend
    const { contents } = req.body;

    // Check if the payload is valid
    if (!contents) {
      return res.status(400).json({ error: 'Missing "contents" in request body.' });
    }
    
    // Add system instructions on the backend for better control and security
    const systemInstruction = {
        role: "system",
        parts: [{text: "You are Solver.AI, an expert in Physics, Chemistry, and Mathematics for the IIT JEE exam. Provide a clear, step-by-step solution. Use LaTeX for all mathematical expressions. Be encouraging and helpful."}]
    };

    // Forward the request to the Google Gemini API
    const geminiResponse = await axios.post(API_URL, { 
        contents,
        // Optional: uncomment to add the system instruction
        // systemInstruction
    });

    // Extract the text from the API response.
    // Use optional chaining (?.) to prevent errors if the structure is unexpected.
    const responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (responseText) {
      // Send the extracted text back to the frontend
      res.json({ text: responseText });
    } else {
      // Handle cases where the API returns a response but no valid text (e.g., safety blocks)
      console.warn("Gemini API response was valid but contained no text.", geminiResponse.data);
      res.status(500).json({ error: 'Received an empty or invalid response from the AI service.' });
    }

  } catch (error) {
    // Handle errors during the API call
    console.error("Error calling Gemini API:", error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to fetch response from the AI service.' });
  }
});
// --- NEW MOCK TEST FEATURE ---

const crypto = require('crypto'); // Built-in Node module for generating unique IDs

// In-memory cache to store tests temporarily without needing a database.
// Structure: { "session_id": { testData: [...], expiresAt: timestamp } }
const activeTestsCache = {}; 

// Clean up expired tests every hour to save RAM
setInterval(() => {
    const now = Date.now();
    for (const sessionId in activeTestsCache) {
        if (activeTestsCache[sessionId].expiresAt < now) {
            delete activeTestsCache[sessionId];
        }
    }
}, 3600000);

// A. Route to generate the test using Gemini
app.post('/api/generate-test', async (req, res) => {
    try {
        const { examType, syllabusType, subject, topic, numQuestions } = req.body;

        // Adjust prompt based on Full Syllabus or Topic-wise
        const scope = syllabusType === "Full Syllabus" 
            ? `the entire full syllabus of ${subject} for ${examType}` 
            : `the specific topic '${topic}' in ${subject} for ${examType}`;

        const prompt = `
        You are an expert ${examType} paper setter. Generate a highly accurate mock test covering ${scope}.
        Generate exactly ${numQuestions} questions.
        
        CRITICAL RULES:
        1. Output ONLY a raw JSON array. No markdown blocks, no conversational text.
        2. Use LaTeX for math/physics/chemistry formulas (wrap inline in $...$, block in $$...$$).
        3. If a question REQUIRES a diagram (e.g., physics circuit, chemical structure, biological diagram), generate clean, responsive raw SVG code and put it in the "diagramSvg" field. Ensure the SVG has a viewBox. If no diagram is needed, leave it as an empty string "".
        
        Format each object in the array exactly like this:
        {
          "questionId": "unique_string_id",
          "text": "Question text here",
          "diagramSvg": "<svg>...</svg> or empty string",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 0, 
          "solution": "Step-by-step detailed solution here"
        }
        `;

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await axios.post(API_URL, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" } // Forces pure JSON
        });

        let responseText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error("Empty response from AI");

        const generatedQuestions = JSON.parse(responseText);
        const testSessionId = crypto.randomUUID();

        // Save FULL test to server RAM (Expires in 4 hours for full tests)
        activeTestsCache[testSessionId] = {
            questions: generatedQuestions,
            expiresAt: Date.now() + (4 * 60 * 60 * 1000)
        };

        // Send a SECURE version to the frontend (Strip correct answers and solutions)
        const secureQuestions = generatedQuestions.map(q => ({
            questionId: q.questionId,
            text: q.text,
            diagramSvg: q.diagramSvg,
            options: q.options
        }));

        res.json({ testSessionId, questions: secureQuestions });

    } catch (error) {
        console.error("Backend Error generating test:", error.message);
        res.status(500).json({ error: "AI failed to generate the test. It might have timed out generating a massive paper. Try generating 25 questions first!" });
    }
});

// B. Route to evaluate the test
app.post('/api/evaluate-test', (req, res) => {
    const { testSessionId, userResponses } = req.body;
    const testSession = activeTestsCache[testSessionId];

    if (!testSession) {
        return res.status(400).json({ error: "Test session expired or invalid." });
    }

    let score = 0;
    const totalMarks = testSession.questions.length * 4;
    const detailedAnalysis = [];

    // Grade it! +4 for correct, -1 for incorrect.
    testSession.questions.forEach((actualQuestion) => {
        const userResponse = userResponses.find(ur => ur.questionId === actualQuestion.questionId);
        const selectedOption = userResponse ? userResponse.selectedOptionIndex : null;
        
        const isCorrect = selectedOption === actualQuestion.correctOptionIndex;

        if (isCorrect) score += 4;
        else if (selectedOption !== null) score -= 1;

        detailedAnalysis.push({
            questionText: actualQuestion.text,
            options: actualQuestion.options,
            userAnswer: selectedOption,
            correctAnswer: actualQuestion.correctOptionIndex,
            isCorrect: isCorrect,
            solution: actualQuestion.solution
        });
    });

    // Clean up memory
    delete activeTestsCache[testSessionId];

    res.json({ score, totalMarks, detailedAnalysis });
});
// --- END MOCK TEST FEATURE ---

// 6. Start the server
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
  console.log('Your Solver.AI application is now ready!');
});
