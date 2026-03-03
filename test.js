module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasSupabaseUrl  = !!process.env.SUPABASE_URL;
  const hasSupabaseKey  = !!process.env.SUPABASE_SERVICE_KEY;
  const hasRazorpayId   = !!process.env.RAZORPAY_KEY_ID;

  // Try a real Anthropic API call
  let anthropicStatus = 'not tested';
  let anthropicError  = null;

  if (hasAnthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK' }],
        }),
      });
      const data = await response.json();
      if (response.ok) {
        anthropicStatus = 'WORKING';
      } else {
        anthropicStatus = 'ERROR';
        anthropicError  = data.error && data.error.message ? data.error.message : JSON.stringify(data);
      }
    } catch (e) {
      anthropicStatus = 'FETCH ERROR';
      anthropicError  = e.message;
    }
  }

  res.status(200).json({
    env_vars: {
      ANTHROPIC_API_KEY:  hasAnthropicKey ? 'SET' : 'MISSING',
      SUPABASE_URL:       hasSupabaseUrl  ? 'SET' : 'MISSING',
      SUPABASE_SERVICE_KEY: hasSupabaseKey ? 'SET' : 'MISSING',
      RAZORPAY_KEY_ID:    hasRazorpayId   ? 'SET' : 'MISSING',
    },
    anthropic_test: anthropicStatus,
    anthropic_error: anthropicError,
  });
};
