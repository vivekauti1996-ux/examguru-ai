const crypto = require('crypto');
const https = require('https');

async function getUser(token, supabaseUrl, serviceKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: new URL(supabaseUrl).hostname,
      path: '/auth/v1/user',
      method: 'GET',
      headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + token }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function supabaseUpsert(body, serviceKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(supabaseUrl);
    const options = {
      hostname: url.hostname,
      path: '/rest/v1/subscriptions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Prefer': 'resolution=merge-duplicates',
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (c) => responseData += c);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(data);
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, token } = req.body;

    const user = await getUser(token, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    if (!user || !user.id) return res.status(401).json({ error: 'Unauthorised' });

    // Verify Razorpay signature
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await supabaseUpsert({
      user_id: user.id,
      plan: plan,
      status: 'active',
      razorpay_payment_id: razorpay_payment_id,
      razorpay_order_id: razorpay_order_id,
      started_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    }, process.env.SUPABASE_SERVICE_KEY, process.env.SUPABASE_URL);

    return res.status(200).json({ success: true, plan: plan, expires_at: expiresAt });
  } catch (err) {
    console.error('Verify payment error:', err);
    return res.status(500).json({ error: 'Payment verification error: ' + err.message });
  }
};

