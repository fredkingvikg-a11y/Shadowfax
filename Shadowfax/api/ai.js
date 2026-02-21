const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = JSON.parse(raw);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON: ' + e.message }) };
  }

  const apiKey = (body.apiKey || '').trim();
  if (!apiKey) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing apiKey' }) };
  }

  const postData = JSON.stringify({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: body.payload && body.payload.max_tokens ? body.payload.max_tokens : 1500,
    messages: body.payload && body.payload.messages ? body.payload.messages : []
  });

  return new Promise(function(resolve) {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: data
        });
      });
    });
    req.on('error', function(err) {
      resolve({ statusCode: 500, body: JSON.stringify({ error: err.message }) });
    });
    req.setTimeout(30000, function() {
      req.destroy();
      resolve({ statusCode: 504, body: JSON.stringify({ error: 'Timeout' }) });
    });
    req.write(postData);
    req.end();
  });
};