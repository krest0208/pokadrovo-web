import { request } from 'node:http';
const origin = new URL(process.env.POKADROVO_PUBLIC_ORIGIN || 'http://localhost:5173');
const req = request({ hostname: '127.0.0.1', port: Number(process.env.POKADROVO_PORT || 5173), path: '/api/health', headers: { Host: origin.host }, timeout: 3000 }, res => {
  res.resume(); process.exitCode = res.statusCode === 200 ? 0 : 1;
});
req.on('timeout', () => req.destroy());
req.on('error', () => { process.exitCode = 1; });
req.end();
