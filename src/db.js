import mysql from 'mysql';
import util from './util';
var BigInteger = require('node-biginteger');

var serverconfig = require(__dirname + '/../src/config/server-config.json');
var dbconfig = require(__dirname + '/../src/config/' + serverconfig.DBCONFIG);
const crypto = require('crypto');

var dbpool = mysql.createPool(dbconfig);

var signatures = new Map([
  [ "0xfdacd576", "set Completed"], // event
  [ "0x60806040", "Transfer"], // event
  [ "0x095ea7b3", "Approve"], // event
  [ "0x5138b08c", "settleAuction"],
  [ "0xebea6025", "withdrawAuction"],
  [ "0xd204c45e", "safeMint"],
  [ "0xe4ddc77c", "lockToken"],
  [ "0x7ad47ac3", "retrieveToken"],
  [ "0x6d098560", "releaseToken"],
  [ "0xa9059cbb", "transfer"]
]);

module.exports = {
	get_pool() {
		return dbpool;
  },

  async get_last_eventlog(address) {
    return new Promise((resolve, reject) => {
      var values = [];

      dbpool.query("select max(blockno) as blockno from eventlogs where address = ?", 
              [address],
              (err, rows) => {
        if (!err) {
          resolve(rows[0].blockno);
        }
        else {
          reject(err);
        }
      });
    });
  },

  async get_last_contract_txlist(address) {
    return new Promise((resolve, reject) => {
      var values = [];

      dbpool.query("select max(blockno) as blockno from txlogs where contract = ?", 
              [address],
              (err, rows) => {
        if (!err) {
          resolve(rows[0].blockno);
        }
        else {
          reject(err);
        }
      });
    });
  },

  async load_token_holders() {
    return new Promise((resolve, reject) => {
      var query = "select address from tokenholders";
      dbpool.query(query, [], (err, rows) => {
        if (!err) {
          resolve(rows);
        }
        else {
          reject(err);
        }
      });
    });
  },

  async get_token_holder_info(address) {
    return new Promise((resolve, reject) => {
      var query = "select address, lastblockno from tokenholders where address = ?";
      dbpool.query(query, [address],
              (err, rows) => {
        if (!err) {
          resolve(rows);
        }
        else {
          reject(err);
        }
      });
    });
  },

  async insert_eventlog(rows) {
    return new Promise((resolve, reject) => {
      var values = [];

      try {
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var blockno = Number(row.blockNumber);
          var ts = Number(row.timeStamp);
          var gasPrice = Number(row.gasPrice);
          var gasUsed = Number(row.gasUsed);
          var logIndex = row.logIndex == '0x' ? 0 : Number(row.logIndex);
          var txid = row.transactionIndex == '0x' ? 0 : Number(row.transactionIndex);

          if (row.topics) {
            values.push(
              [
                blockno, row.address, ts, row.topics[0], row.topics.length > 1 ? row.topics[1] : '', 
                row.topics.length > 2 ? row.topics[2] : '', row.topics.length > 3 ? row.topics[3] : '', 
                row.data, gasPrice, gasUsed, row.transactionHash, logIndex, txid, JSON.stringify(row)
              ]);
          } else {
            console.log('insert_eventlog: no topics', row);
          }
        }
      } catch(e) {
        console.log('insert_eventlog: exception', e);
        reject(e);
      }

      if (values.length == 0) {
        resolve(0);
      }
      else {
        dbpool.query("insert into eventlogs (blockno, address, timestamp, topics0, topics1, topics2, topics3, data, gasPrice, gasUsed, txhash, logindex, txindex, logtext) values ?" +
                "on duplicate key update txindex = values(txindex)", 
                [values],
                (err, rows) => {
          if (!err) {
            resolve(rows.affectedRows);
          }
          else {
            console.log('insert_eventlog', err);
            reject(err);
          }
        });
      }
    });
  },

  update_eventlog(txhash, logindex, target_address, decoded) {
    return new Promise((resolve, reject) => {
      var params = [target_address, decoded, txhash, logindex];
      var query = 'update eventlogs set target_address = ?, decoded = ? where txhash = ? and logindex = ?';

      dbpool.query(query, params, (err, rows) => {
        if (!err) {
          resolve(rows);
        }
        else {
          reject(err);
        }
      });
    });
  },
  
  load_eventlog(address, keytype, from, to) {
    return new Promise((resolve, reject) => {
      var params = [address, from];
      var query = `select * from eventlogs where address = ? and ${keytype} > ? `;
      if (to) {
        query += ` and ${keytype} < ?`;
        params.push(to);
      }
      query += ' order by blockno asc, timestamp asc';

      dbpool.query(query, params, (err, rows) => {
        if (!err) {
          resolve(rows);
        }
        else {
          reject(err);
        }
      });
    });
  },

  // 1개 업데이트
  async update_tokenlockstat(address, lockdata, amount, regdate, owneraddress) {
    return new Promise((resolve, reject) => {
      var query = `
        insert into tokenlockstat (address, lockdata, amount, regdate, owneraddress) values (?, ?, ?, ?, ?) 
          on duplicate key update lockdata = values(lockdata), amount = values(amount), regdate = values(regdate), owneraddress = values(owneraddress)
      `;
      dbpool.query(query,
            [address, lockdata, amount, regdate, owneraddress], (err, rows) => {
          if (err) console.log(err);
          resolve(0);
      });
    });
  },

  // 여러개 insert
  async update_tokenlockstats(lists) {
    return new Promise((resolve, reject) => {
      var query = `
        insert into tokenlockstat (address, lockdata, amount, regdate, owneraddress, updatedate) 
            values ? on duplicate key update lockdata = values(lockdata), amount = values(amount), 
            regdate = values(regdate), owneraddress = values(owneraddress), updatedate = values(updatedate)
      `;
      dbpool.query(query, [lists], (err, rows) => {
          if (err) console.log(err);
          resolve(0);
      });
    });
  },

  async update_tokenholders(lists) {
    return new Promise((resolve, reject) => {
      var query = `
        insert into tokenholders (owneraddress, address, tokenbalance, lockamount, regdate, updatedate) 
            values ? on duplicate key update tokenbalance = values(tokenbalance), lockamount = values(lockamount), 
            regdate = values(regdate), updatedate = values(updatedate)
      `;
      dbpool.query(query, [lists], (err, rows) => {
          if (err) console.log(err);
          resolve(0);
      });
    });
  },

  async load_all_tokenlockstats() {
    return new Promise((resolve, reject) => {
      dbpool.query("select address, lockdata, regdate from tokenlockstat",
            [], (err, rows) => {
              resolve(rows);
      });
    });
  },

  async read_tokenlockstat(address) {
    return new Promise((resolve, reject) => {
      var query = "select lockdata, regdate from tokenlockstat where address = ?";
      dbpool.query(query, [address], (err, rows) => resolve(rows));
    });
  },

  async read_tokenlocklogs(address) {
    return new Promise((resolve, reject) => {
      var query = "select blockno, timestamp, txhash, topics0, decoded from eventlogs where target_address = ?";
      dbpool.query(query, [address], (err, rows) => resolve(rows));
    });
  },

  async load_all_tokenholders(contractAddress) {
    return new Promise((resolve, reject) => {
      var query = "select address, tokenbalance, lockamount, regdate, updatedate from tokenholders where owneraddress = ?";
      dbpool.query(query, [contractAddress], (err, rows) => {
        resolve(rows);
      });
    });
  },

  async update_tokenbalance(address, tokenbalance) {
    return new Promise((resolve, reject) => {
      var query = "update tokenholders set tokenbalance = ? where address = ?";
      dbpool.query(query, [tokenbalance.toString(), address], (err, rows) => resolve(0));
    });
  },

  update_nft_owner(nftaddress, tokenId, to, mintdate) {
    return new Promise((resolve, reject) => {
      dbpool.query("insert into nft (nftaddress, tokenid, owner, mintdate, updatetime) values (?, ?, ?, from_unixtime(?), now()) " +
        "on duplicate key update owner = values(owner), mintdate = greatest(mintdate, values(mintdate))",
            [nftaddress, tokenId, to, mintdate], (err, rows) => {
              resolve(0);
            });
    });
  },

  load_all_nfts() {
    return new Promise((resolve, reject) => {
      dbpool.query("select nftaddress, tokenid, owner from nft",
            [], (err, rows) => resolve(rows));
    });
  },

  async insert_token_holder(address, tokenbalance) {
    return new Promise((resolve, reject) => {
      dbpool.query("insert into tokenholders (address, tokenbalance) values (?,?) " +
              "on duplicate key update tokenbalance = values(tokenbalance)",
              [address, tokenbalance], (err, rows) => resolve(0));
    });
  },

  async load_event_logs(contractAddress, blockno) {
    return new Promise((resolve, reject) => {
      var params = [contractAddress];
      var query = "select blockno as blockid, timestamp as logdate, logtext from eventlogs where address = ?";
      if (blockno) {
        query += " and blockno > ?";
        params.push(blockno);
      }

      dbpool.query(query, params, (err, rows) => resolve(rows));
    });
  },
  
  async insert_txlist(address, rows) {
    return new Promise((resolve, reject) => {
      var values = [];
      var addresslist = [];
      var regdate = 0;
      var lastblockno = 0;

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var blockno = Number(row.blockNumber);
        var value = row.value == '0x' ? 0 : Number(row.value);
        var to = row.to;
        var contract = '';
        
        if (regdate == 0) 
          regdate = row.timeStamp;
          
        if (row.value == '0' || row.value == '0x') {
          var _leadingSignature = row.input.substring(0, 10);
          var signature = signatures.get(_leadingSignature);

          if (signature) {
            if (signature == 'transfer') {
              // to, value
              contract = to;
              to = '0x' + row.input.substring(10 + 24, 10 + 64);
              var valueText = row.input.substring(10 + 64);
              value = BigInteger.fromString(valueText, 16);
            }
            else if (signature == 'lockToken') {
              // from, to, value, time
              // 0xe4ddc77c000000000000000000000000e45a45ac626af21809a77eedc22ac6b84e111e460000000000000000000000003c3588ec7b34f18b95c7ae3774b4b006d382ceb800000000000000000000000000000000000000000000ada44a009dcd1880000000000000000000000000000000000000000000000000000000000000649feb10
              contract = to;
              to = '0x' + row.input.substring(10 + 64 + 24, 10 + 64 + 64);
              value = BigInteger.fromString(row.input.substring(10 + 64 + 64, 10 + 64 + 64 + 64), 16);
            }
          }
          else {
            signature = _leadingSignature;
            if (row.input.length > 38 * 2) {
              value = BigInteger.fromString(row.input.substring(37 * 2, 37 * 2 + 64), 16);
              if (to == '' && row.input.contractAddress == '')
                to = row.input.substring(5 * 2, 38 * 2);
            }

            // contract creation
            if (to == '' && row.input.contractAddress != '')
              value = BigInteger.zero;
            contract = to;
          }
        }

        //console.log(signature, to, valueText, value.toString());

        var date = new Date(Number(row.timeStamp) * 1000);

        values.push(
          [
            blockno, row.hash, row.from, to, value, contract, signature, JSON.stringify(row), date,
          ]
        );

        if (row.from != address && addresslist.indexOf(row.from) == -1)
          addresslist.push(row.from);
        if (to != address && addresslist.indexOf(to) == -1)
          addresslist.push(to);

        lastblockno = blockno;
      }

      dbpool.query("insert into txlogs (blockno, txhash, `from`, `to`, `value`, contract, signature, data, regdate) values ? " +
              "on duplicate key update value = values(value), contract = values(contract)",
              [values],
              async (err, rows) => {
        if (!err) {
          resolve([addresslist, lastblockno, regdate, values]);
        }
        else {
          console.log(err);
          reject(err);
        }
      });
    });
  },

  async load_tokenlockstat(ownerAddress, lastdate) {
    return new Promise((resolve, reject) => {
      var params = [];
      var wheres = [];
      var query = "select lockdata, updatedate from tokenlockstat";
      if (ownerAddress) {
        wheres.push(" ownerAddress = ? ");
        params.push(ownerAddress);
      }
      if (lastdate) {
        wheres.push(" updatedate > ? ");
        params.push(lastdate);
      }

      if (wheres.length > 0) {
        query += " where " + wheres.join(" and ");
      }

      dbpool.query(query, params, (err, rows) => resolve(rows));
    });
  },

  async load_lasttxid(address) {
    return new Promise((resolve, reject) => {
      dbpool.query("select ifnull(lastid, 0) as lastid from lasttxid where address = ?", [address], (err, rows) => resolve(rows.length > 0 ? rows[0]['lastid'] : 0));
    });    
  },

  async insert_lasttxid(address, lastid) {
    return new Promise((resolve, reject) => {
      dbpool.query("insert into lasttxid (address, lastid) values (?,?) on duplicate key update lastid = values(lastid)", 
        [address, lastid], (err, rows) => resolve(rows));
    });    
  }

  // {"blockNumber":"19198250","timeStamp":"1656765258","hash":"0x45ce736f8dca9a9fad7a2217dd418490ae8dc44fc636b98bb19e214a1feb0abd",
  //"nonce":"0","blockHash":"0xaf8a87093709b3925bb6f757305a1659ab7ce8b9d86e93076c074d6484f9d193","transactionIndex":"108",
  //"from":"0x8cb476b3798558e0b102030a3dd4d9d46e5d6574","to":"0x517396bd11d750e4417b82f2b0fcfa62a4f2bb96","value":"0","gas":"52124",
  //"gasPrice":"5000000000","isError":"0","txreceipt_status":"1",
  //"input":"0xa9059cbb000000000000000000000000f1376a0befed55bae41e53dcfcd6535d203c7fad0000000000000000000000000000000000000000000000056bc75e2d63100000",
  //"contractAddress":"","cumulativeGasUsed":"14024654","gasUsed":"52124","confirmations":"28308"},
}
