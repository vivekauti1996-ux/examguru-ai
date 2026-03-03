const https = require('https');

const LIMITS = { free: 3, pro: 999, booster: 9999 };

async function supabaseRequest(path, method, body, serviceKey, supabaseUrl) {
  const url = new URL(supabaseUrl + '/rest/v1' + path);
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : '',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseData || '[]') }); }
        catch(e) { resolve({ status: res.statusCode, data: [] }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getUser(token, supabaseUrl, serviceKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(supabaseUrl).hostname,
      path: '/auth/v1/user',
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + token,
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, stream = false, token } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    let userId = null;
    let userPlan = 'free';

    // Check user and plan
    if (token && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const user = await getUser(token, SUPABASE_URL, SUPABASE_KEY);
        if (user && user.id) {
          userId = user.id;
          const today = new Date().toISOString();
          const subRes = await supabaseRequest(
            `/subscriptions?user_id=eq.${userId}&status=eq.active&expires_at=gte.${today}&select=plan&limit=1`,
            'GET', null, SUPABASE_KEY, SUPABASE_URL
          );
          if (subRes.data && subRes.data[0]) userPlan = subRes.data[0].plan;
        }
      } catch(e) { /* continue without auth */ }
    }

    const dailyLimit = LIMITS[userPlan] || LIMITS.free;

    // Check & update usage
    if (userId && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const todayDate = new Date().toISOString().split('T')[0];
        const usageRes = await supabaseRequest(
          `/usage?user_id=eq.${userId}&date=eq.${todayDate}&select=count&limit=1`,
          'GET', null, SUPABASE_KEY, SUPABASE_URL
        );
        const currentCount = (usageRes.data && usageRes.data[0]) ? usageRes.data[0].count : 0;

        if (currentCount >= dailyLimit) {
          return res.status(429).json({
            error: 'limit_reached',
            plan: userPlan,
            limit: dailyLimit,
            message: userPlan === 'free'
              ? 'Free limit reached. Upgrade to Pro for unlimited access!'
              : 'Daily limit reached. Try again tomorrow.',
          });
        }

        await supabaseRequest('/usage', 'POST',
          { user_id: userId, date: todayDate, count: currentCount + 1 },
          SUPABASE_KEY, SUPABASE_URL
        );
      } catch(e) { /* continue without usage tracking */ }
    }

    // Call Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        stream: stream,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      const err = await anthropicResponse.json();
      return res.status(anthropicResponse.status).json({ error: err });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = anthropicResponse.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      res.end();
    } else {
      const data = await anthropicResponse.json();
      res.status(200).json(data);
    }

  } catch (err) {
    console.error('Chat API Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
