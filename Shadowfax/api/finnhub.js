export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY = process.env.FINNHUB_API_KEY;
  const { type, symbol } = req.query;
  if (!KEY) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const BASE = 'https://finnhub.io/api/v1';
  const sym = symbol.toUpperCase();
  async function fh(path) {
    const r = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}token=${KEY}`);
    return r.json();
  }
  function timeAgo(ms) {
    const diff = Date.now() - ms;
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (h < 1) return 'just now';
    if (h < 24) return h + 'h ago';
    return d + 'd ago';
  }
  try {
    if (type === 'signals') {
      const today = new Date();
      const from = new Date(today - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to = today.toISOString().split('T')[0];
      const [profile, quote, recs, targets, news, earnings, surprises, insider] = await Promise.all([
        fh(`/stock/profile2?symbol=${sym}`),
        fh(`/quote?symbol=${sym}`),
        fh(`/stock/recommendation?symbol=${sym}`),
        fh(`/stock/price-target?symbol=${sym}`),
        fh(`/company-news?symbol=${sym}&from=${from}&to=${to}`),
        fh(`/calendar/earnings?symbol=${sym}`),
        fh(`/stock/earnings?symbol=${sym}&limit=4`),
        fh(`/stock/insider-transactions?symbol=${sym}`)
      ]);
      const latestRec = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
      const totalRec = latestRec ? (latestRec.buy + latestRec.strongBuy + latestRec.hold + latestRec.sell + latestRec.strongSell) : 1;
      const bullPct = latestRec ? Math.round((latestRec.buy + latestRec.strongBuy) / totalRec * 100) : 50;
      const bearPct = latestRec ? Math.round((latestRec.sell + latestRec.strongSell) / totalRec * 100) : 20;
      const neutPct = Math.max(0, 100 - bullPct - bearPct);
      const sentScore = Math.min(95, Math.round(bullPct * 0.65 + neutPct * 0.25));
      const direction = sentScore >= 60 ? 'Bullish' : sentScore >= 40 ? 'Neutral' : 'Bearish';
      const price = quote.c || 0;
      const ptMean = targets.targetMean || null;
      const ptHigh = targets.targetHigh || null;
      const ptLow = targets.targetLow || null;
      const ptUpside = ptMean && price ? ((ptMean - price) / price * 100).toFixed(1) : null;
      const headlines = (Array.isArray(news) ? news : []).slice(0, 5).map(n => ({
        text: n.headline,
        source: n.source,
        time: timeAgo(n.datetime * 1000),
        sentiment: (n.sentiment || 0) > 0.1 ? 'bullish' : (n.sentiment || 0) < -0.1 ? 'bearish' : 'neutral',
        url: n.url || ''
      }));
      const nextEarnings = earnings && Array.isArray(earnings.earningsCalendar) && earnings.earningsCalendar.length > 0
        ? earnings.earningsCalendar[0] : null;
      const earningsDays = nextEarnings ? Math.ceil((new Date(nextEarnings.date) - today) / 86400000) : null;
      const histMoves = (Array.isArray(surprises) ? surprises : []).slice(0, 4).map(e => ({
        quarter: e.period || '',
        surprise: e.surprise || 0,
        surprisePct: e.surprisePercent || 0,
        actual: e.actual || 0,
        estimate: e.estimate || 0
      }));
      const avgSurprisePct = histMoves.length > 0
        ? (histMoves.reduce((s, e) => s + Math.abs(e.surprisePct || 0), 0) / histMoves.length).toFixed(1)
        : null;
      const insiderData = insider && Array.isArray(insider.data) ? insider.data.slice(0, 10) : [];
      const insiderBuys = insiderData.filter(t => t.transactionType && t.transactionType.includes('P')).length;
      const insiderSells = insiderData.filter(t => t.transactionType && t.transactionType.includes('S')).length;
      const insiderSignal = insiderBuys > insiderSells ? 'Bullish' : insiderBuys < insiderSells ? 'Bearish' : 'Neutral';
      res.json({
        ticker: sym,
        company: profile.name || sym,
        industry: profile.finnhubIndustry || '',
        price, change: quote.d || 0, pct: quote.dp || 0,
        score: sentScore, direction, bull: bullPct, neut: neutPct, bear: bearPct,
        earningsDays: earningsDays > 0 ? earningsDays : null,
        nextEarningsDate: nextEarnings ? nextEarnings.date : null,
        analystPT: ptMean ? Math.round(ptMean) : null,
        ptHigh: ptHigh ? Math.round(ptHigh) : null,
        ptLow: ptLow ? Math.round(ptLow) : null,
        ptUpside, totalAnalysts: totalRec,
        recBuy: latestRec ? latestRec.buy + latestRec.strongBuy : 0,
        recHold: latestRec ? latestRec.hold : 0,
        recSell: latestRec ? latestRec.sell + latestRec.strongSell : 0,
        headlines, histMoves, avgSurprisePct,
        insiderBuys, insiderSells, insiderSignal,
        insiderTx: insiderData.slice(0, 4).map(t => ({
          name: t.name || 'Unknown',
          type: t.transactionType || '',
          shares: t.share || 0,
          value: t.value || 0,
          date: t.transactionDate || ''
        }))
      });
    } else if (type === 'targets') {
      const [targets, recs, quote] = await Promise.all([
        fh(`/stock/price-target?symbol=${sym}`),
        fh(`/stock/recommendation?symbol=${sym}`),
        fh(`/quote?symbol=${sym}`)
      ]);
      const latestRec = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
      res.json({ targets, rec: latestRec, price: quote.c || 0 });
    } else if (type === 'earnings') {
      const [surprises, calendar] = await Promise.all([
        fh(`/stock/earnings?symbol=${sym}&limit=8`),
        fh(`/calendar/earnings?symbol=${sym}`)
      ]);
      res.json({ surprises, calendar });
    } else {
      res.status(400).json({ error: 'invalid type' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
