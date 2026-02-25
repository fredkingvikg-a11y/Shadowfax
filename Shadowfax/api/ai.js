const https = require('https');

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

  const payload = JSON.stringify({
    model: 'deepseek/deepseek-chat-v3-0324:free',
    max_tokens: maxTokens,
    messages: messages
  });

  return new Promise(function(resolve) {
    const req2 = https.request({
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
          var data = Buffer.concat(chunks).toString('utf8');
          var p = JSON.parse(data);
          var text = p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content
            ? p.choices[0].message.content.trim() : '';
          if (text) {
            res.status(200).json({ content: [{ type: 'text', text: text }] });
          } else {
            res.status(500).json({ error: 'Empty response', debug: JSON.stringify(p).substring(0, 300) });
          }
        } catch(e) {
          res.status(500).json({ error: 'Parse error: ' + e.message });
        }
        resolve();
      });
    });
    req2.on('error', function(e) { res.status(500).json({ error: e.message }); resolve(); });
    req2.setTimeout(30000, function() { req2.destroy(); res.status(504).json({ error: 'Timeout' }); resolve(); });
    req2.write(payload);
    req2.end();
  });
};
