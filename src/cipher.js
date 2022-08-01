var crypto = require('crypto');

function hex2a(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2) 
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return str;
}

var aesalgorithm = 'aes-256-cbc';

module.exports = {
  encryptAES(plainText, enckey) {
    const key = Buffer.from(enckey, 'utf8');
    const iv = Buffer.from(enckey, 'utf8');

    const cipher = crypto.createCipheriv(aesalgorithm, key.slice(0, 32), iv.slice(0, 16));
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  },

  decryptAES(cipherText, enckey) {
    if (cipherText && cipherText != '') {
      const key = Buffer.from(enckey, 'utf8');
      const iv = Buffer.from(enckey, 'utf8');

      const decipher = crypto.createDecipheriv(aesalgorithm, key.slice(0, 32), iv.slice(0, 16));
      let decrypted = decipher.update(cipherText, 'base64');
      decrypted += decipher.final();
      return decrypted;
    } else {
      return '';
    }
  },

  createSHA256Hash(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  },

};