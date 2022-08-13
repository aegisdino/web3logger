import express from 'express';

const bip39 = require('bip39');
const cipher = require('./cipher.js');

var router = express.Router();
var app;

var serverconfig = require(__dirname + '/../src/config/server-config.json');

var tokenlockmgr = require('./tokenlockmgr.js');
var nftmgr = require('./nftmgr.js');

var db = require('./db.js');
var util = require('./util.js');

router.startServer = async function (_app) {
  app = _app;

  tokenlockmgr.start(this);
  //nftmgr.start(this);
};

async function send_lockdata(res, address, details) {
  try {
    var txlist = [];
    if (details) {
      var _txlists = await db.read_tokenlocklogs(address);
      for (var i = 0; i < _txlists.length; i++) {
        var e = _txlists[i];
        var decoded = JSON.parse(_txlists[i].decoded);
        txlist.push({ blockno: e.blockno, txhash: e.txhash, timestamp: e.timestamp, event : tokenlockmgr.get_topic0(e.topics0), amount: decoded['2'], slot: decoded['4'] ?? decoded['3'] });
      }
    }

    var lockdata = tokenlockmgr.find(address);
    if (lockdata) {
      console.log(`[${util.currentTime()}] ${lockdata.stat.address}: ${lockdata.stat.amount} ITEMs, #${lockdata.stat.count}, txlist# ${txlist.length} (cache)`);
      res.json({ result : 0, data: lockdata, txlist: txlist });
    }
    else {
      // 캐시에 없으면 디비에 있는 걸 보내줌
      db.read_tokenlockstat(address).then((rows) => {
        if (rows.length> 0) {          
          var lockdata = JSON.parse(rows[0].lockdata);
          console.log(`[${util.currentTime()}] ${lockdata.stat.address}: ${lockdata.stat.amount} ITEMs, #${lockdata.stat.count}, txlist# ${txlist.length} (db)`);
          res.json({ result : 0, data: lockdata, txlist: txlist });
        } else {
          res.json({ result : 1, address: address });
        }
      });
    }
  } catch(e) {
    console.log('send_lockdata', e);
    res.sendStatus(500);
  }  
}

router.post('/lockamount', async (req, res) => {
  //console.log('/lockamount(post)', req.body);
  send_lockdata(res, req.body.address.trim().toLowerCase(), true);
});

router.get('/lockamount', async (req, res) => {
  //console.log('/lockamount(get)', req.query);
  send_lockdata(res, req.query.address.trim().toLowerCase(), req.query.txlist == 'y');
});

router.get('/lockstat', async (req, res) => {
  res.json(tokenlockmgr.get_lockstats());
});

router.get('/loadlogs', async (req, res) => {
  var rows = await db.load_event_logs(req.query.address.trim().toLowerCase(), req.query.blockno);
  res.json({ result : 0, data: rows });
});


function get_decrypted_data(res, data, userseed) {
  try {
    var decrypted = cipher.decryptAES(data, userseed+serverconfig.ENCRYPTKEY);
    return JSON.parse(decrypted); 
  } catch(e) {
    console.log('get_decrypted_data', e);
    if (res)
      res.json({ result : 99, error: 'decrypt failed' });
    return undefined;
  }  
}

router.post('/hdwallet', async (req, res) => {
  console.log('/hdwallet', req.body);

  var jsondata = get_decrypted_data(null, req.body.data, req.body.timestamp.toString()) || {};
  const mnemonic = bip39.generateMnemonic(jsondata.strong ? 256 : 128);
  var seedbytes = jsondata.password && jsondata.password.length > 0 ? 
        bip39.mnemonicToSeedSync(mnemonic, jsondata.password).toString('hex') :
        bip39.mnemonicToSeedSync(mnemonic).toString('hex');
  var plainText = JSON.stringify({ mnemonic: mnemonic, seedBytes: seedbytes });
  var encdata = cipher.encryptAES(plainText, req.body.timestamp.toString()+serverconfig.ENCRYPTKEY);
  res.json({ result : 0, data: encdata });
});

router.post('/computeseedbytes', async (req, res) => {
  console.log('/computeseedbytes', req.body);

  var jsondata = get_decrypted_data(res, req.body.data, req.body.timestamp.toString());
  console.log(jsondata);
  var seedbytes = jsondata.password && jsondata.password.length > 0 ? 
        bip39.mnemonicToSeedSync(jsondata.mnemonic, jsondata.password).toString('hex') :
        bip39.mnemonicToSeedSync(jsondata.mnemonic).toString('hex');

  var encdata = cipher.encryptAES(seedbytes, req.body.timestamp.toString()+serverconfig.ENCRYPTKEY);
  res.json({ result : 0, data: encdata });
});

module.exports = router;


