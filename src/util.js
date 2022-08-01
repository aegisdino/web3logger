var serverconfig = require(__dirname + '/../src/config/server-config.json');
const fs = require('fs');
var crypto = require('crypto');

String.prototype.format = function () {
  var args = arguments;
  return this.replace(/{(\d+)}/g, function (match, number) {
    return typeof args[number] != 'undefined' ? args[number] : match;
  });
};

var timezoneOffset = new Date().getTimezoneOffset() * 60000;
console.log('Asia/Seoul timezoneOffset should be -9', timezoneOffset/(60000*60));

module.exports = {
  humanizeFloat(x, coin) {
    var digits = serverconfig.COINDIGITS[coin] !== undefined ? serverconfig.COINDIGITS[coin] : 1;
    return parseFloat(x).toFixed(digits).replace(/\.?0*$/, '');
  },

  getDBTime(d) {
    // delete the dot and everything after
    if (typeof d == 'object')
      return new Date(d).toISOString().replace(/T/, ' ').replace(/\..+/, '');
    else
      return this.getDBTime(new Date(d));
  },

  NOW() { 
    return this.getDBTime(new Date(Date.now()-timezoneOffset));
  },
  
  currentTime() {
	  return (new Date(Date.now()-timezoneOffset).toISOString()).replace(/T/, ' ').replace(/\..+/, '');
  },

  addDays(date, days) {
    var result = date ? new Date(date) : new Date(Date.now()-timezoneOffset);
    result.setDate(result.getDate() + days);
    return result;
  },

  escape_chatmsg(msg) {
    return msg.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
      switch (char) {
        case "\0":
          return "\\0";
        case "\x08":
          return "\\b";
        case "\x09":
          return "\\t";
        case "\x1a":
          return "\\z";
        case "\n":
          return "\\n";
        case "\r":
          return "\\r";
        case "\"":
        case "'":
        case "\\":
        case "%":
          return "\\" + char; // prepends a backslash to backslash, percent,
        // and double/single quotes
      }
    });
  },

  degreeToRadian(angle) {
    return Math.PI * angle / 180.0;
  },

  radianToDegree(radian) {
    return radian * 180.0 / Math.PI;
  },

  // kilo meter
  getGPSDistance(lat1, lng1, lat2, lng2) {
    var pi1 = this.degreeToRadian(lat1);
    var pi2 = this.degreeToRadian(lat2);
    var p1 = this.degreeToRadian(lng1 - lng2) * Math.cos((pi1 + pi2) / 2);
    var p2 = (pi1 - pi2);
    return 6371 * Math.sqrt(p1 * p1 + p2 * p2);
  },

  generateImageHash(path) {
    var data = fs.readFileSync(path, 'utf8');
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  },

  getRandomInt(min, max) { //min ~ max 
    return Math.floor(Math.random() * (max - min)) + min;
  },

  isNotEmptyString(value) {
    return (value && value.length > 0);
  },
  
  split_names(name) {
    var names = name.split(' ');
    if (names.length == 1) {
      names = [ name.substr(0, 1), name.substr(1) ];
    }
    return names;
  }
}

