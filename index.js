const http = require('http');

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || '(not set)';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', db: DB_URL }));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`DATABASE_URL: ${DB_URL}`);
});
