const https = require('https');
const url = process.argv[2] || 'https://help.sprypt.com/guide/appointment-booking-commercial-insurance-pay-with-referral-physician-options';
https.get(url, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const matches = data.match(/uploads-ssl.webflow.com[^"' >]*/g) || [];
    const unique = [...new Set(matches.map(m => (m.startsWith('http') ? m : 'https:' + m)) )];
    if (unique.length === 0) {
      console.log('No Webflow asset URLs found.');
    } else {
      unique.forEach(u => console.log(u));
    }
  });
}).on('error', err => { console.error('Fetch error:', err.message); process.exit(1); });
