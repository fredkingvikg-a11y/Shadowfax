const https = require('https');

function tryModel(model, messages, maxTokens, apiKey) {
  return new Promise(function(resolve) {
    const payload = JSON.stringify({ model: model, max_tokens: maxTokens, messages: messages });
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://shadowfax-puce.vercel.app',
        'X-Title': 'Shadowfax',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function(response) {
      var chunks = [];
      response.on('data', function(c) { chunks.push(c); });
      response.on('end', function() {
        try {
          var p = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          var text = p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content
            ? p.choices[0].message.content.trim() : '';
          resolve(text || null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(20000, function() { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' }); return; }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { res.status(400).json({ error: 'Invalid JSON' }); return; }
  }

  const messages = body && body.messages ? body.messages : [];
  const maxTokens = body && body.max_tokens ? parseInt(body.max_tokens) : 1000;

  /* Try multiple free models in order until one works */
  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'google/gemma-3-27b-it:free',
    'mistralai/mistral-small-3.1-24b-instruct:free'
  ];

  for (var i = 0; i < models.length; i++) {
    const result = await tryModel(models[i], messages, maxTokens, apiKey);
    if (result) {
      res.status(200).json({ content: [{ type: 'text', text: result }] });
      return;
    }
  }

  res.status(500).json({ error: 'All models failed' });
};
