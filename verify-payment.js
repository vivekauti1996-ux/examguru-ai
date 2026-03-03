import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, token } = req.body;

    // 1. Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorised' });

    // 2. Verify Razorpay signature (security check — prevents fake payments)
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // 3. Activate subscription in Supabase (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { error: upsertError } = await supabase
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        plan,
        status: 'active',
        razorpay_payment_id,
        razorpay_order_id,
        started_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) throw upsertError;

    return res.status(200).json({ success: true, plan, expires_at: expiresAt });

  } catch (err) {
    console.error('Verify payment error:', err);
    return res.status(500).json({ error: 'Payment verification error' });
  }
}
