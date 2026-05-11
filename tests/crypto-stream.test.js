'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Readable, Writable } = require('stream');
const { createEncryptStream, createDecryptStream, decryptFileBuffer } = require('../crypto-utils');

function encryptLegacyFileBuffer(input, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

async function testRoundTrip() {
  const key = crypto.randomBytes(32);
  const input = Buffer.from('large-file-stream-round-trip-' + 'x'.repeat(1024 * 128), 'utf8');
  const encryptedChunks = [];

  await new Promise((resolve, reject) => {
    Readable.from([input])
      .pipe(createEncryptStream(key))
      .on('data', chunk => encryptedChunks.push(chunk))
      .on('error', reject)
      .on('end', resolve);
  });

  const decryptedChunks = [];
  await new Promise((resolve, reject) => {
    Readable.from(encryptedChunks)
      .pipe(createDecryptStream(key))
      .on('data', chunk => decryptedChunks.push(chunk))
      .on('error', reject)
      .on('end', resolve);
  });

  assert.deepStrictEqual(Buffer.concat(decryptedChunks), input, 'stream encrypt/decrypt should round-trip data');
}

async function testLegacyFormatCanStillDecrypt() {
  const key = crypto.randomBytes(32);
  const input = Buffer.from('legacy-file-format-' + 'y'.repeat(1024 * 64), 'utf8');
  const legacyEncrypted = encryptLegacyFileBuffer(input, key);
  const decrypted = decryptFileBuffer(legacyEncrypted, key);
  assert.deepStrictEqual(decrypted, input, 'buffer decrypt should remain compatible with legacy file format');
}

async function testEncryptionStreamsBeforeSourceEnds() {
  const key = crypto.randomBytes(32);
  let sawEncryptedOutputBeforeEnd = false;
  let sourceEnded = false;

  const source = new Readable({
    read() {}
  });

  const sink = new Writable({
    write(chunk, encoding, callback) {
      if (chunk.length > 0 && !sourceEnded) {
        sawEncryptedOutputBeforeEnd = true;
      }
      callback();
    }
  });

  const done = new Promise((resolve, reject) => {
    sink.on('finish', resolve);
    sink.on('error', reject);
  });

  source.pipe(createEncryptStream(key)).pipe(sink);
  source.push(Buffer.alloc(1024 * 64, 1));
  await new Promise(resolve => setImmediate(resolve));
  sourceEnded = true;
  source.push(null);
  await done;

  assert.strictEqual(sawEncryptedOutputBeforeEnd, true, 'encrypt stream should emit data before source finishes');
}

async function main() {
  await testRoundTrip();
  await testLegacyFormatCanStillDecrypt();
  await testEncryptionStreamsBeforeSourceEnds();
  console.log('crypto-stream tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
