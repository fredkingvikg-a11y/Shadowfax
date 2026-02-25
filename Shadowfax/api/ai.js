const https = require('https');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  /* Key lives securely on the server — never sent to browser */
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured on server' }); return; }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { res.status(400).json({ error: 'Invalid JSON' }); return; }
  }

  const messages = body && body.messages ? body.messages : [];
  const userMessage = messages.map(function(m) {
    return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  }).join('\n');
  const maxTokens = (body && body.max_tokens) ? parseInt(body.max_tokens) : 1500;
  
  if (!userMessage || !userMessage.trim()) {
    res.status(400).json({ error: 'Empty message' });
    return;
  }

  const geminiPayload = JSON.stringify({
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
  });

  const path = '/v1beta/models/gemini-1.5-flash-8b:generateContent?key=' + apiKey;

  return new Promise(function(resolve) {
    const reqHttp = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(geminiPayload)
      }
    }, function(response) {
      var data = '';
      response.on('data', function(chunk) { data += chunk; });
      response.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var text = parsed.candidates &&
                     parsed.candidates[0] &&
                     parsed.candidates[0].content &&
                     parsed.candidates[0].content.parts &&
                     parsed.candidates[0].content.parts[0] &&
                     parsed.candidates[0].content.parts[0].text
                     ? parsed.candidates[0].content.parts[0].text : '';
          res.status(200).json({ content: [{ type: 'text', text: text }] });
        } catch(e) {
          res.status(500).json({ error: 'Parse error', raw: data.substring(0, 200) });
        }
        resolve();
      });
    });
    reqHttp.on('error', function(err) { res.status(500).json({ error: err.message }); resolve(); });
    reqHttp.setTimeout(30000, function() { reqHttp.destroy(); res.status(504).json({ error: 'Timeout' }); resolve(); });
    reqHttp.write(geminiPayload);
    reqHttp.end();
  });
};
