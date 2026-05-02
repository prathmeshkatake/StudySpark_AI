// Vercel Serverless Function - Proxies requests to Gemini API
// API keys are stored in Vercel Environment Variables (never in code)

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get all API keys from Vercel environment variables
    const apiKeys = [];
    if (process.env.GEMINI_KEY_1) apiKeys.push(process.env.GEMINI_KEY_1);
    if (process.env.GEMINI_KEY_2) apiKeys.push(process.env.GEMINI_KEY_2);
    if (process.env.GEMINI_KEY_3) apiKeys.push(process.env.GEMINI_KEY_3);
    if (process.env.GEMINI_KEY_4) apiKeys.push(process.env.GEMINI_KEY_4);
    if (process.env.GEMINI_KEY_5) apiKeys.push(process.env.GEMINI_KEY_5);

    if (apiKeys.length === 0) {
        return res.status(500).json({ error: 'No API keys configured on server.' });
    }

    const { prompt, isJson } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    // Try each key until one works (auto-switching)
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
        };

        if (isJson) {
            requestBody.generationConfig.responseMimeType = "application/json";
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.status === 429) {
                console.log(`Key ${i + 1} rate limited, trying next...`);
                continue; // Try next key
            }

            if (!response.ok) {
                const errData = await response.json();
                // If key is expired/invalid, try next key
                if (errData.error?.status === 'PERMISSION_DENIED' || errData.error?.code === 403) {
                    console.log(`Key ${i + 1} expired, trying next...`);
                    continue;
                }
                return res.status(response.status).json({ error: errData.error?.message || 'API request failed' });
            }

            const data = await response.json();
            const text = data.candidates[0].content.parts[0].text;
            return res.status(200).json({ text });

        } catch (error) {
            console.error(`Key ${i + 1} failed:`, error.message);
            continue; // Try next key
        }
    }

    return res.status(429).json({ error: 'All API keys exhausted. Please try again in a minute.' });
}
