const https = require('https');
const crypto = require('crypto');

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

async function razorpayRequest(path, body, keyId, keySecret) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
    const options = {
      hostname: 'api.razorpay.com',
      path: '/v1' + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + auth,
        'Content-Length': Buffer.byteLength(data),
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (c) => responseData += c);
      res.on('end', () => { try { resolve(JSON.parse(responseData)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const PLANS = {
  pro:     { amount: 9900,  name: 'ExamGuru Pro',   description: 'Unlimited AI questions + Notes' },
  booster: { amount: 19900, name: 'Exam Booster',   description: 'Pro + Mock Tests + Priority support' },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, token } = req.body;
    if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const user = await getUser(token, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    if (!user || !user.id) return res.status(401).json({ error: 'Unauthorised' });

    const planDetails = PLANS[plan];
    const order = await razorpayRequest('/orders', {
      amount: planDetails.amount,
      currency: 'INR',
      receipt: 'order_' + user.id.slice(0,8) + '_' + Date.now(),
      notes: { user_id: user.id, plan: plan, email: user.email },
    }, process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan_name: planDetails.name,
      description: planDetails.description,
      key_id: process.env.RAZORPAY_KEY_ID,
      user_email: user.email || '',
      user_name: user.user_metadata && user.user_metadata.full_name ? user.user_metadata.full_name : '',
    });
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ error: 'Failed to create order: ' + err.message });
  }
};
