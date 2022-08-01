import express from 'express';

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
  send_lockdata(res, req.body.address.trim().toLowerCase(), req.body.txlist);
});

router.get('/lockamount', async (req, res) => {
  //console.log('/lockamount(get)', req.query);
  send_lockdata(res, req.query.address.trim().toLowerCase(), req.query.txlist == 'y');
});


router.get('/lockstat', async (req, res) => {
  res.json(tokenlockmgr.get_lockstats());
});

module.exports = router;


