import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Daily limits per plan
const LIMITS = { free: 3, pro: 999, booster: 9999 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, stream = false, token } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // ── 1. Identify user ──────────────────────────────────────────────
    let userId = null;
    let userPlan = 'free';

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
        const today = new Date().toISOString();
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan, status, expires_at')
          .eq('user_id', userId)
          .eq('status', 'active')
          .gte('expires_at', today)
          .single();
        if (sub) userPlan = sub.plan;
      }
    }

    const dailyLimit = LIMITS[userPlan] ?? LIMITS.free;

    // ── 2. Check & update usage ────────────────────────────────────────
    if (userId) {
      const today = new Date().toISOString().split('T')[0];
      const { data: usage } = await supabase
        .from('usage')
        .select('count')
        .eq('user_id', userId)
        .eq('date', today)
        .single();

      const currentCount = usage?.count ?? 0;
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

      await supabase
        .from('usage')
        .upsert({ user_id: userId, date: today, count: currentCount + 1 },
                 { onConflict: 'user_id, date' });
    }

    // ── 3. Call Anthropic ─────────────────────────────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        stream,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      res.end();
    } else {
      const data = await response.json();
      res.status(200).json(data);
    }

  } catch (err) {
    console.error('Chat API Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
