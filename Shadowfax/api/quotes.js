const https = require('https');

function fetchOne(sym) {
  return new Promise(function(resolve) {
    const url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=1d';
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://finance.yahoo.com',
        'Referer': 'https://finance.yahoo.com/'
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var meta = parsed && parsed.chart && parsed.chart.result && parsed.chart.result[0] && parsed.chart.result[0].meta;
          if (meta && meta.regularMarketPrice) {
            var prev = meta.chartPreviousClose || meta.regularMarketPrice;
            var price = meta.regularMarketPrice;
            var chg = price - prev;
            var pct = prev ? (chg / prev * 100) : 0;
            resolve({ symbol: sym, price: price, chg: chg, pct: pct });
          } else {
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(8000, function() { req.destroy(); resolve(null); });
  });
}

exports.handler = async function(event) {
  const symbols = event.queryStringParameters && event.queryStringParameters.symbols;
  if (!symbols) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No symbols' }) };
  }

  const symList = symbols.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  const results = await Promise.all(symList.map(fetchOne));

  const quoteResponse = { result: results.filter(Boolean) };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify({ quoteResponse: quoteResponse })
  };
};