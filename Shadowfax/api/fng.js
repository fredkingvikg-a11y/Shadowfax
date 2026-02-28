export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });
    const d = await r.json();
    const fng = d.fear_and_greed;
    res.json({ score: Math.round(fng.score), rating: fng.rating });
  } catch(e) {
    res.status(500).json({ error: 'failed' });
  }
}
