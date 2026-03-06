'use strict';
/**
 * 加密工具模块
 * 使用 AES-256-GCM 对文本和文件流进行加密/解密
 * 密钥独立于安全码，从 data/secret.key 文件加载或自动生成
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');

const ALGORITHM = 'aes-256-gcm';
const KEY_FILE = path.join(__dirname, 'data', 'secret.key');

/**
 * 初始化加密密钥
 * 若 data/secret.key 不存在则自动生成 32 字节随机密钥并写入文件
 * @returns {Buffer} 32 字节密钥
 */
function initEncryptionKey() {
  // 确保 data 目录存在
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    const keyHex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('密钥文件格式错误：密钥长度必须为 32 字节（64 位十六进制字符）');
    }
    console.log('[加密] 已从 data/secret.key 加载加密密钥');
    return key;
  }

  // 生成新密钥
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600 });
  console.log('[加密] 已自动生成新的加密密钥并保存到 data/secret.key');
  console.log('[加密] 请妥善备份此文件，丢失后加密数据将无法解密！');
  return newKey;
}

/**
 * 加密文本
 * 格式：base64(iv):base64(authTag):base64(ciphertext)
 * @param {string} plaintext 明文
 * @param {Buffer} key 32 字节密钥
 * @returns {string} 加密后的字符串
 */
function encryptText(plaintext, key) {
  const iv = crypto.randomBytes(12); // GCM 推荐 12 字节 IV
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * 解密文本
 * @param {string} encoded 加密后的字符串（格式：iv:authTag:ciphertext）
 * @param {Buffer} key 32 字节密钥
 * @returns {string} 解密后的明文
 */
function decryptText(encoded, key) {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('加密数据格式无效');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

/**
 * 创建文件加密 Transform 流
 * 格式：[4字节IV长度][12字节IV][16字节authTag][加密数据]
 * 注意：GCM 需要收集完整数据才能获取 authTag，此处用 Buffer 收集后一次性输出
 * @param {Buffer} key 32 字节密钥
 * @returns {Transform}
 */
function createEncryptStream(key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const chunks = [];
  let headerWritten = false;

  return new Transform({
    transform(chunk, encoding, callback) {
      chunks.push(cipher.update(chunk));
      callback();
    },
    flush(callback) {
      try {
        chunks.push(cipher.final());
        const authTag = cipher.getAuthTag();
        // 写入头部：IV(12字节) + AuthTag(16字节)
        if (!headerWritten) {
          this.push(iv);         // 12字节
          this.push(authTag);    // 16字节
          headerWritten = true;
        }
        // 写入加密数据
        for (const chunk of chunks) {
          this.push(chunk);
        }
        callback();
      } catch (err) {
        callback(err);
      }
    }
  });
}

/**
 * 创建文件解密 Transform 流
 * 格式：[12字节IV][16字节authTag][加密数据]
 * @param {Buffer} key 32 字节密钥
 * @returns {Transform}
 */
function createDecryptStream(key) {
  const HEADER_SIZE = 28; // 12(IV) + 16(authTag)
  let headerBuffer = Buffer.alloc(0);
  let headerParsed = false;
  let decipher = null;

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        if (!headerParsed) {
          // 积累头部数据
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          if (headerBuffer.length >= HEADER_SIZE) {
            const iv = headerBuffer.slice(0, 12);
            const authTag = headerBuffer.slice(12, 28);
            const remaining = headerBuffer.slice(HEADER_SIZE);

            decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);
            headerParsed = true;

            if (remaining.length > 0) {
              this.push(decipher.update(remaining));
            }
          }
        } else {
          this.push(decipher.update(chunk));
        }
        callback();
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      try {
        if (decipher) {
          this.push(decipher.final());
        }
        callback();
      } catch (err) {
        callback(new Error('文件解密失败：数据可能已损坏或密钥不正确'));
      }
    }
  });
}

module.exports = {
  initEncryptionKey,
  encryptText,
  decryptText,
  createEncryptStream,
  createDecryptStream
};
