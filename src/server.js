'use strict';

const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/fullchain.pem')
};

https.createServer(options, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
}).listen(8443);
