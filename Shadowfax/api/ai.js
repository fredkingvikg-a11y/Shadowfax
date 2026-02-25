const https = require('https');

function callGemini(messages, maxTokens, apiKey) {
  return new Promise(function(resolve) {
    const userMessage = messages.map(function(m) {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    }).join('\n');

    const payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var p = JSON.parse(data);
          /* Check for quota/error */
          if (p.error) { resolve({ ok: false, error: p.error.status }); return; }
          var text = p.candidates && p.candidates[0] && p.candidates[0].content &&
                     p.candidates[0].content.parts && p.candidates[0].content.parts[0] &&
                     p.candidates[0].content.parts[0].text ? p.candidates[0].content.parts[0].text : '';
          resolve({ ok: !!text, text: text });
        } catch(e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
    req.setTimeout(20000, function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function callOpenRouter(messages, maxTokens, apiKey) {
  return new Promise(function(resolve) {
    const payload = JSON.stringify({
      model: 'openrouter/auto',
      max_tokens: maxTokens,
      messages: messages
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://shadowfax.vercel.app',
        'X-Title': 'Shadowfax',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var p = JSON.parse(data);
          var text = p.choices && p.choices[0] && p.choices[0].message &&
                     p.choices[0].message.content ? p.choices[0].message.content : '';
          if (!text) {
            resolve({ ok: false, error: 'empty response: ' + JSON.stringify(p).substring(0, 200) });
          } else {
            resolve({ ok: true, text: text });
          }
        } catch(e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
    req.setTimeout(25000, function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { res.status(400).json({ error: 'Invalid JSON' }); return; }
  }

  const messages = body && body.messages ? body.messages : [];
  const maxTokens = (body && body.max_tokens) ? parseInt(body.max_tokens) : 1500;

  if (!messages.length) { res.status(400).json({ error: 'No messages' }); return; }

  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  /* Debug — remove after fix */
  if (!geminiKey && !openrouterKey) {
    res.status(500).json({ error: 'No keys found', env: Object.keys(process.env).filter(function(k){ return k.includes('API'); }) });
    return;
  }

  let geminiResult = { ok: false, error: 'not tried' };
  let openrouterResult = { ok: false, error: 'not tried' };

  /* Try Gemini first if key exists */
  if (geminiKey) {
    geminiResult = await callGemini(messages, maxTokens, geminiKey);
  }

  /* Fall back to OpenRouter if Gemini failed or hit quota */
  if (!geminiResult.ok && openrouterKey) {
    openrouterResult = await callOpenRouter(messages, maxTokens, openrouterKey);
  }

  const result = geminiResult.ok ? geminiResult : openrouterResult;

  if (result.ok && result.text) {
    res.status(200).json({ content: [{ type: 'text', text: result.text }] });
  } else {
    res.status(500).json({ 
      error: 'All AI providers failed', 
      gemini: geminiResult.error || 'unknown',
      openrouter: openrouterResult.error || 'unknown'
    });
  }
};
