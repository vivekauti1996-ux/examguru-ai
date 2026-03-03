import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service role key — never expose to frontend
);

// Plan prices in paise (₹ × 100)
const PLANS = {
  pro:      { amount: 9900,  name: 'ExamGuru Pro',     description: 'Unlimited AI questions + Notes' },
  booster:  { amount: 19900, name: 'Exam Booster',     description: 'Pro + Mock Tests + PDF Notes' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, token } = req.body;
    if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    // Verify user token from Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorised' });

    const planDetails = PLANS[plan];

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: planDetails.amount,
      currency: 'INR',
      receipt: `order_${user.id}_${Date.now()}`,
      notes: { user_id: user.id, plan, email: user.email },
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan_name: planDetails.name,
      description: planDetails.description,
      key_id: process.env.RAZORPAY_KEY_ID,
      user_email: user.email,
      user_name: user.user_metadata?.full_name || '',
    });

  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}
