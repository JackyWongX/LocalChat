const { exec } = require('child_process');
const fs = require('fs');

console.log('Generating self-signed certificate...');

exec('powershell.exe -Command "New-SelfSignedCertificate -DnsName localhost -CertStoreLocation cert:\\LocalMachine\\My"', (error, stdout, stderr) => {
  if (error) {
    console.error('Error generating certificate:', error);
    return;
  }
  console.log('Certificate generated. Please export it as PFX and convert to PEM manually, or use HTTP for now.');
});