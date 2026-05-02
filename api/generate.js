// Vercel Serverless Function - Secure Gemini API Proxy
// API keys are stored in Vercel Environment Variables (never in code)

module.exports = async function handler(req, res) {
    // Allow CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Get all API keys from Vercel environment variables
    const apiKeys = [
        process.env.GEMINI_KEY_1,
        process.env.GEMINI_KEY_2,
        process.env.GEMINI_KEY_3,
        process.env.GEMINI_KEY_4,
        process.env.GEMINI_KEY_5,
    ].filter(Boolean); // Remove undefined/empty ones

    if (apiKeys.length === 0) {
        return res.status(500).json({ error: 'No API keys configured on server. Please set GEMINI_KEY_1 in Vercel env vars.' });
    }

    const { prompt, isJson } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

    // Try each key with auto-switching on rate limit
    for (let i = 0; i < apiKeys.length; i++) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeys[i]}`;
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
        };
        if (isJson) requestBody.generationConfig.responseMimeType = "application/json";

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.status === 429 || response.status === 403) {
                console.log(`Key ${i + 1} exhausted/expired, trying next...`);
                continue;
            }

            if (!response.ok) {
                const errData = await response.json();
                return res.status(response.status).json({ error: errData.error?.message || 'Gemini API error' });
            }

            const data = await response.json();
            const text = data.candidates[0].content.parts[0].text;
            return res.status(200).json({ text });

        } catch (err) {
            console.error(`Key ${i + 1} threw error:`, err.message);
            continue;
        }
    }

    return res.status(429).json({ error: 'All API keys exhausted. Try again in a minute.' });
};
