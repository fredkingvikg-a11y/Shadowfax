const https = require('https');

function fetchOne(sym) {
  return new Promise(function(resolve) {
    const url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=1d';
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
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
          } else { resolve(null); }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(8000, function() { req.destroy(); resolve(null); });
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const symbols = req.query && req.query.symbols;
  if (!symbols) { res.status(400).json({ error: 'No symbols' }); return; }
  const symList = symbols.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  const results = await Promise.all(symList.map(fetchOne));
  res.status(200).json({ quoteResponse: { result: results.filter(Boolean) } });
};