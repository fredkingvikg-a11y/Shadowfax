export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const KEY = process.env.FRED_API_KEY;
  const BASE = 'https://api.stlouisfed.org/fred/series/observations';

  async function fred(id, limit) {
    const r = await fetch(`${BASE}?series_id=${id}&api_key=${KEY}&file_type=json&limit=${limit}&sort_order=desc`);
    const d = await r.json();
    return d.observations || [];
  }

  try {
    const [fedFunds, yieldCurve, cpi, unemp, yq] = await Promise.all([
      fred('FEDFUNDS', 3),
      fred('T10Y2Y', 1),
      fred('CPIAUCSL', 13),
      fred('UNRATE', 1),
      fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=^VIX,^GSPC,^TNX', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }).then(r => r.json())
    ]);

    const rate = parseFloat(fedFunds[0]?.value) || 0;
    const ratePrev = parseFloat(fedFunds[2]?.value) || rate;
    const rateTrend = rate > ratePrev + 0.1 ? 'Rising' : rate < ratePrev - 0.1 ? 'Falling' : 'Stable';
    const spread = parseFloat(yieldCurve[0]?.value) || 0;
    const cpiNow = parseFloat(cpi[0]?.value) || 0;
    const cpiOld = parseFloat(cpi[12]?.value) || cpiNow;
    const cpiYoY = cpiOld > 0 ? (cpiNow - cpiOld) / cpiOld * 100 : 0;
    const unempRate = parseFloat(unemp[0]?.value) || 0;

    const quotes = yq?.quoteResponse?.result || [];
    const vix = quotes.find(q => q.symbol === '^VIX')?.regularMarketPrice || 20;
    const spxChg = quotes.find(q => q.symbol === '^GSPC')?.regularMarketChangePercent || 0;
    const yield10 = quotes.find(q => q.symbol === '^TNX')?.regularMarketPrice || 4;

    /* DETERMINISTIC REGIME SCORING */
    let score = 0;
    const factors = [];

    /* VIX — 0 to 30 pts */
    if (vix < 15)      { score += 30; factors.push({ n: 'VIX', v: vix.toFixed(1), s: 'bullish', note: 'Low volatility, risk appetite high' }); }
    else if (vix < 20) { score += 20; factors.push({ n: 'VIX', v: vix.toFixed(1), s: 'neutral', note: 'Normal volatility, stable conditions' }); }
    else if (vix < 28) { score += 8;  factors.push({ n: 'VIX', v: vix.toFixed(1), s: 'caution', note: 'Elevated volatility, reduce size' }); }
    else               { score += 0;  factors.push({ n: 'VIX', v: vix.toFixed(1), s: 'bearish', note: 'High volatility, risk-off conditions' }); }

    /* Yield Curve 10Y-2Y — 0 to 25 pts */
    if (spread > 0.5)      { score += 25; factors.push({ n: '10Y-2Y Spread', v: '+'+spread.toFixed(2)+'%', s: 'bullish', note: 'Normal curve, expansion expected' }); }
    else if (spread > 0)   { score += 14; factors.push({ n: '10Y-2Y Spread', v: spread.toFixed(2)+'%',  s: 'neutral', note: 'Flat curve, growth slowing' }); }
    else                   { score += 0;  factors.push({ n: '10Y-2Y Spread', v: spread.toFixed(2)+'%',  s: 'bearish', note: 'Inverted curve, recession risk elevated' }); }

    /* CPI YoY — 0 to 25 pts */
    if (cpiYoY < 2.5)      { score += 25; factors.push({ n: 'CPI YoY', v: cpiYoY.toFixed(1)+'%', s: 'bullish', note: 'Inflation controlled, Fed has flexibility' }); }
    else if (cpiYoY < 3.5) { score += 16; factors.push({ n: 'CPI YoY', v: cpiYoY.toFixed(1)+'%', s: 'neutral', note: 'Inflation moderating, watch trend' }); }
    else if (cpiYoY < 5)   { score += 6;  factors.push({ n: 'CPI YoY', v: cpiYoY.toFixed(1)+'%', s: 'caution', note: 'Above target, Fed likely hawkish' }); }
    else                   { score += 0;  factors.push({ n: 'CPI YoY', v: cpiYoY.toFixed(1)+'%', s: 'bearish', note: 'High inflation, aggressive tightening risk' }); }

    /* Fed Policy — 0 to 20 pts */
    if (rateTrend === 'Falling') { score += 20; factors.push({ n: 'Fed Policy', v: rate.toFixed(2)+'%', s: 'bullish', note: 'Fed cutting, accommodative conditions' }); }
    else if (rateTrend === 'Stable') { score += 12; factors.push({ n: 'Fed Policy', v: rate.toFixed(2)+'%', s: 'neutral', note: 'Fed on hold, data-dependent' }); }
    else                         { score += 0;  factors.push({ n: 'Fed Policy', v: rate.toFixed(2)+'%', s: 'bearish', note: 'Fed hiking, tightening financial conditions' }); }

    /* Determine regime */
    let regime, label, color, summary, favor, avoid;
    if (score >= 82) {
      regime = 'Risk-On Growth'; label = 'RISK-ON'; color = 'green';
      summary = 'Strong bullish macro: low volatility, healthy yield curve, inflation controlled, Fed accommodative.';
      favor = ['Long calls on growth stocks', 'Bull call spreads', 'Momentum longs', 'Tech and discretionary'];
      avoid = ['Long volatility plays', 'Defensive-only positioning', 'Short duration bonds'];
    } else if (score >= 62) {
      regime = 'Cautious Bullish'; label = 'NEUTRAL+'; color = 'green';
      summary = 'Generally positive conditions with some headwinds. Selective bullish positioning appropriate.';
      favor = ['Defined risk spreads', 'Quality value stocks', 'Covered calls for income'];
      avoid = ['Naked short puts on high beta', 'Max leverage positions'];
    } else if (score >= 42) {
      regime = 'Mixed / Transitional'; label = 'NEUTRAL'; color = 'yellow';
      summary = 'Conflicting macro signals. Reduce size, favor hedged positions, avoid large directional bets.';
      favor = ['Iron condors', 'Calendar spreads', 'Cash-heavy positioning'];
      avoid = ['Large directional bets', 'Short volatility', 'High leverage'];
    } else if (score >= 20) {
      regime = 'Risk-Off / Defensive'; label = 'RISK-OFF'; color = 'red';
      summary = 'Bearish macro environment. Capital preservation priority. Multiple warning signals active.';
      favor = ['Long puts as portfolio hedges', 'Defensive sectors', 'Short duration bonds', 'Cash'];
      avoid = ['Long calls on growth', 'Short volatility strategies', 'Momentum longs'];
    } else {
      regime = 'Bear / Recession Risk'; label = 'BEARISH'; color = 'red';
      summary = 'Maximum macro stress. Recession indicators flashing. Extreme caution, minimal exposure.';
      favor = ['Long VIX calls', 'Put spreads on indices', 'Gold', 'Maximum cash'];
      avoid = ['Long equity exposure', 'Any short volatility', 'Cyclical sectors'];
    }

    res.json({
      regime, label, color, summary, score,
      factors,
      rateEnv: `${rate.toFixed(2)}% (${rateTrend})`,
      inflationEnv: `${cpiYoY.toFixed(1)}% YoY`,
      vixLevel: `${vix.toFixed(1)} (${vix < 15 ? 'Low' : vix < 20 ? 'Normal' : vix < 28 ? 'Elevated' : 'High'})`,
      yieldCurve: `${spread >= 0 ? '+' : ''}${spread.toFixed(2)}% (${spread >= 0 ? 'Normal' : 'Inverted'})`,
      unemployment: `${unempRate.toFixed(1)}%`,
      riskAppetite: score >= 75 ? 'High' : score >= 55 ? 'Moderate' : score >= 35 ? 'Low' : 'Very Low',
      favorStrategies: favor,
      avoidStrategies: avoid,
      drivers: factors.map(f => f.n + ': ' + f.note)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
