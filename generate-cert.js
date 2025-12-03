const { exec } = require('child_process');
const fs = require('fs');

console.log('Generating self-signed certificate...');

// Use openssl to generate key.pem and cert.pem
exec('openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/C=CN/ST=State/L=City/O=Organization/CN=localhost"', (error, stdout, stderr) => {
  if (error) {
    console.error('Error generating certificate:', error);
    console.log('Make sure OpenSSL is installed. You can download it from https://slproweb.com/products/Win32OpenSSL.html');
    return;
  }
  console.log('Certificate generated: key.pem and cert.pem');
  console.log('You can now run the server with HTTPS.');
});