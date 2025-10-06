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
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

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

// 6. Start the server
app.listen(PORT, () => {
  console.log(`Server is running successfully on http://localhost:${PORT}`);
  console.log('Your Solver.AI application is now ready!');
});