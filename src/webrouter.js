import express from 'express';

const bip39 = require('bip39');
const cipher = require('./cipher.js');

var router = express.Router();
var app;

var serverconfig = require(__dirname + '/../src/config/server-config.json');

var tokenlockmgr = require('./tokenlockmgr.js');
var nftmgr = require('./nftmgr.js');
var balancemgr = require('./balancemgr.js');

var db = require('./db.js');
var util = require('./util.js');

router.startServer = async function (_app) {
  app = _app;

  tokenlockmgr.start(this);
  balancemgr.start('0x517396bD11d750E4417B82F2b0FcFa62a4f2bB96');

  //nftmgr.start(this);
};

async function send_lockdata(res, address, details) {
  var result = await read_lockdata(address, details);
  if (result != null) {
    res.json(result);
  } else {
    res.sendStatus(500);
  }  
}

async function read_lockdata(address, details) {
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
      return { result : 0, data: lockdata, txlist: txlist };
    }
    else {
      // 캐시에 없으면 디비에 있는 걸 보내줌
      var rows = await db.read_tokenlockstat(address);
      if (rows.length> 0) {          
        var lockdata = JSON.parse(rows[0].lockdata);
        console.log(`[${util.currentTime()}] ${lockdata.stat.address}: ${lockdata.stat.amount} ITEMs, #${lockdata.stat.count}, txlist# ${txlist.length} (db)`);
        return { result : 0, data: lockdata, txlist: txlist };
      } else {
        return { result : 1, address: address };
      }
    }
  } catch(e) {
    console.log('send_lockdata: exception', e);
    return null;
  }  
}

router.post('/lockamount', async (req, res) => {
  //console.log('/lockamount(post)', req.body);
  send_lockdata(res, req.body.address.trim().toLowerCase(), true);
});

router.get('/lockamount', async (req, res) => {
  //console.log('/lockamount(get)', req.query);
  if (req.query.view != 'txt') {
    send_lockdata(res, req.query.address.trim().toLowerCase(), req.query.txlist == 'y');
  }
  else {
    var result = await read_lockdata(req.query.address.trim().toLowerCase(), req.query.txlist == 'y');
    res.send('<pre>' + JSON.stringify(result, null, 4) + '</pre>');
  }
});

// 날짜별 잠금 상태 웹에서 보고자 할 때
router.get('/dailylockstat', async (req, res) => {
  var data = tokenlockmgr.get_lockstats();
  if (req.query.view == 'txt')
    res.send('<pre>' + JSON.stringify(data, null, 4) + '</pre>');
  else
    res.json(data);
});

// 모든 이벤트 로그를 요청
// 데이터를 한번에 받아가는 형태라 느림
router.get('/loadlogs', async (req, res) => {
  var rows = await db.load_event_logs(req.query.address.trim().toLowerCase(), req.query.blockno);
  res.json({ result : 0, data: rows });
});

router.get('/loadtokenlockstats', async (req, res) => { 
  var address = req.query.address ? req.query.address.trim().toLowerCase() : undefined;
  var lastdate = req.query.lastdate ? util.getDBTime(new Date(req.query.lastdate * 1000)) : undefined;
  var rows = await db.load_tokenlockstat(address, lastdate);
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
  var seedbytes = jsondata.password && jsondata.password.length > 0 ? 
        bip39.mnemonicToSeedSync(jsondata.mnemonic, jsondata.password).toString('hex') :
        bip39.mnemonicToSeedSync(jsondata.mnemonic).toString('hex');

  var encdata = cipher.encryptAES(seedbytes, req.body.timestamp.toString()+serverconfig.ENCRYPTKEY);
  res.json({ result : 0, data: encdata });
});

module.exports = router;


