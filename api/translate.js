const MODEL = 'google/gemma-2-9b-it:free';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://riad-dar-nakhil.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, from = 'ar', to = 'en' } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid text' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenRouter API key not configured' });
  }

  const prompt = `Translate the following text from ${from} to ${to}. Return only the translation, no explanations:\n\n${text}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://riad-dar-nakhil.com',
        'X-Title': 'Riad Dar Nakhil Translator'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(502).json({ error: 'Translation service error', details: errorData });
    }

    const data = await response.json();
    const translated = data.choices?.[0]?.message?.content?.trim() || '';

    return res.status(200).json({ original: text, translated, from, to });

  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}