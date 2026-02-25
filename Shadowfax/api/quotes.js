const https = require('https');

function fetchAlpaca(symbols) {
  return new Promise(function(resolve) {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    if (!apiKey || !secretKey) {
      resolve(null);
      return;
    }

    const symStr = symbols.join(',');
    const path = '/v2/stocks/snapshots?symbols=' + encodeURIComponent(symStr) + '&feed=iex';

    const req = https.request({
      hostname: 'data.alpaca.markets',
      path: path,
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
        'Accept': 'application/json'
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var result = [];
          Object.keys(parsed).forEach(function(sym) {
            var snap = parsed[sym];
            if (snap && snap.latestTrade) {
              var price = snap.latestTrade.p || 0;
              var prevClose = snap.prevDailyBar ? snap.prevDailyBar.c : price;
              var chg = price - prevClose;
              var pct = prevClose ? (chg / prevClose * 100) : 0;
              result.push({ symbol: sym, price: price, chg: chg, pct: pct });
            }
          });
          resolve(result.length ? result : null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(8000, function() { req.destroy(); resolve(null); });
    req.end();
  });
}

function fetchYahooOne(sym) {
  return new Promise(function(resolve) {
    const url = '/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=1d';
    const req = https.request({
      hostname: 'query2.finance.yahoo.com',
      path: url,
      method: 'GET',
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
    req.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbols = req.query && req.query.symbols;
  if (!symbols) { res.status(400).json({ error: 'No symbols' }); return; }

  const allSyms = symbols.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  /* Separate regular stocks from indices/futures (Alpaca doesn't support ^ or =) */
  var stockSyms = allSyms.filter(function(s) { return !s.startsWith('^') && !s.endsWith('=F'); });
  var indexSyms = allSyms.filter(function(s) { return s.startsWith('^') || s.endsWith('=F'); });

  var result = [];

  /* Fetch stocks via Alpaca (real-time) */
  if (stockSyms.length) {
    var alpacaResult = await fetchAlpaca(stockSyms);
    if (alpacaResult) {
      result = result.concat(alpacaResult);
    } else {
      /* Alpaca failed — fall back to Yahoo for stocks */
      var stockFallback = await Promise.all(stockSyms.map(fetchYahooOne));
      result = result.concat(stockFallback.filter(Boolean));
    }
  }

  /* Fetch indices/futures via Yahoo (Alpaca doesn't support these) */
  if (indexSyms.length) {
    var indexResults = await Promise.all(indexSyms.map(fetchYahooOne));
    result = result.concat(indexResults.filter(Boolean));
  }

  res.status(200).json({ quoteResponse: { result: result } });
};
