module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, stream, token } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in environment variables' });
    }

    // ── Usage limiting (Supabase) ─────────────────────────────────────
    const LIMITS = { free: 3, pro: 999, booster: 9999 };
    const https = require('https');
    let userId = null;
    let userPlan = 'free';

    if (token) {
      try {
        const user = await new Promise((resolve) => {
          const opts = {
            hostname: new URL(process.env.SUPABASE_URL).hostname,
            path: '/auth/v1/user', method: 'GET',
            headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
          };
          const r = https.request(opts, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
          });
          r.on('error', () => resolve(null)); r.end();
        });
        if (user && user.id) {
          userId = user.id;
          const today = new Date().toISOString();
          const subRes = await new Promise((resolve) => {
            const path = `/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&expires_at=gte.${encodeURIComponent(today)}&select=plan&limit=1`;
            const opts = {
              hostname: new URL(process.env.SUPABASE_URL).hostname,
              path, method: 'GET',
              headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY }
            };
            const r = https.request(opts, (res) => {
              let d = ''; res.on('data', c => d += c);
              res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve([]); } });
            });
            r.on('error', () => resolve([])); r.end();
          });
          if (subRes && subRes[0]) userPlan = subRes[0].plan;
        }
      } catch(e) { /* continue */ }
    }

    if (userId) {
      try {
        const todayDate = new Date().toISOString().split('T')[0];
        const usageRes = await new Promise((resolve) => {
          const path = `/rest/v1/usage?user_id=eq.${userId}&date=eq.${todayDate}&select=count&limit=1`;
          const opts = {
            hostname: new URL(process.env.SUPABASE_URL).hostname,
            path, method: 'GET',
            headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY }
          };
          const r = https.request(opts, (res) => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve([]); } });
          });
          r.on('error', () => resolve([])); r.end();
        });
        const currentCount = usageRes && usageRes[0] ? usageRes[0].count : 0;
        const dailyLimit = LIMITS[userPlan] || 3;

        if (currentCount >= dailyLimit) {
          return res.status(429).json({
            error: 'limit_reached',
            message: userPlan === 'free' ? 'Free limit reached. Upgrade to Pro!' : 'Daily limit reached.'
          });
        }

        // Update usage count
        await new Promise((resolve) => {
          const body = JSON.stringify({ user_id: userId, date: todayDate, count: currentCount + 1 });
          const opts = {
            hostname: new URL(process.env.SUPABASE_URL).hostname,
            path: '/rest/v1/usage', method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': process.env.SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
              'Prefer': 'resolution=merge-duplicates',
              'Content-Length': Buffer.byteLength(body)
            }
          };
          const r = https.request(opts, (res) => { res.on('data', () => {}); res.on('end', resolve); });
          r.on('error', resolve); r.write(body); r.end();
        });
      } catch(e) { /* continue */ }
    }

    // ── Call Anthropic ────────────────────────────────────────────────
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        stream: !!stream,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    // Return detailed error if Anthropic call fails
    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errBody);
      return res.status(anthropicRes.status).json({
        error: 'Anthropic API error',
        status: anthropicRes.status,
        details: errBody
      });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      return res.end();
    } else {
      const data = await anthropicRes.json();
      return res.status(200).json(data);
    }

  } catch (err) {
    console.error('Chat handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
