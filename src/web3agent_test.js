import axios from 'axios';
var bigInt = require("big-integer");
var db = require('./db.js');
const Web3 = require('web3')

var serverconfig = require(__dirname + '/../src/config/server-config.json');

var contractAddress = '0x517396bD11d750E4417B82F2b0FcFa62a4f2bB96';
var lockContractAddress = '0x824660d0f3BA91FD84ad0D36e45B88189A06326a';

var myContracts = [contractAddress.toLowerCase(), lockContractAddress.toLowerCase()];

var apiKey = "2BUPCDPXTUMGBGJXMCWDS184B3DRDEC96D";
var scanHost = "https://api.bscscan.com/api?";

module.exports = {
	async start(contract) {
        var lastid = await db.get_last_eventlog(contract);
        while (true) {
            var count = await this.scan_logs(lastid, 'latest', contract);
            console.log(lastid, count);
            if (count == 0) break;
            var lastid = await db.get_last_eventlog(contract);
            if (count < 1000)
                lastid++;
        }

        //await this.recursive_scan_txlist(contractAddress, 0);
        //await this.recursive_scan_txlist(lockContractAddress, 0);

        this.update_tokenholders_balance();
    },

    async update_tokenholders_balance() {
        db.load_token_holders().then(async (rows) => {
            for (var i = 0; i < rows.length; i++) {
                var balance = await this.query_token_balance(rows[i].address);
                db.update_tokenbalance(rows[i].address, balance);
            }
        });
    },
   
    async scan_logs(from, to, address) {
        console.log('scan_logs: ', address);

        var query = `${scanHost}module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}&apikey=${apiKey}`;
        var res = await axios.get(query, {});
        if (res.data.result.length > 0) {
            await db.insert_eventlog(res.data.result);
            return res.data.result;
        } else {
            return [];
        }
    },

    async recursive_scan_txlist(address, depth) {
        var existingwallets = depth == 0 ? [] : await db.get_token_holder_info(address);
        if (existingwallets.length == 0) {
            console.log(`recursive_scan_txlist: '${address}'`);

            var lastid = depth == 0 ? db.get_last_contract_txlist(address) : 0;
            var results = await this.scan_txlist(lastid, 'latest', address, true);
            var addresslist = results[2];
            if (results[0].length == 10000) {
                var lastid = results[1];
                for (var trycount = 0; trycount < 1000; trycount++) {
                    var nextresults = await this.scan_txlist(lastid, 'latest', address, true);
                    if (nextresults[0] < 10000) break;
                    lastid = nextresults[1];
                    addresslist.push(nextresults[2].filter(v => addresslist.indexOf(v) == -1));
                }
            }

            if (depth == 0) {
                for (var i = 0; i < addresslist.length; i++) {
                    if (addresslist[i] != '')
                        await this.recursive_scan_txlist(addresslist[i], depth+1);
                }
            }
        } else {
            //console.log('recursive_scan_txlist: skip', address);
        }
    },

    async scan_txlist(from, to, address, onlyTokenContract) {
        var query = `${scanHost}module=account&action=txlist&startBlock=${from}&endBlock=${to}&address=${address}&apikey=${apiKey}`;
        var res = await axios.get(query, {});
        if (res.data.result && res.data.result.length > 0) {
            var txlist = (onlyTokenContract) ? res.data.result.filter(v => myContracts.indexOf(v.to) != -1) : res.data.result;
            console.log('scan_txlist', address, res.data.result.length, '=>', txlist.length);

            if (txlist.length > 0) {
                var results = await db.insert_txlist(address, txlist);

                var addresslist = results[0];
                var lastblockno = results[1];
                var regdate = results[2];

                var tokenbalance = await this.query_token_balance(address);
                await db.insert_token_holder(address, lastblockno, regdate, tokenbalance);
                          
                console.log(`${txlist.length} items inserted [lastblockno ${lastblockno}, new address # ${addresslist.length}]`);                
                return [txlist.length, lastblockno, addresslist];
            }
        } 
        
        await db.insert_token_holder(address, 0, 0, 0);
        return [0, 0, []];
    },

    async query_token_balance(address) {
        var query = `${scanHost}module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${address}&tag=latest&apikey=${apiKey}`;
        var res = await axios.get(query, {});
        if (res.data.result) {
            var balance = BigInteger.fromString(res.data.result);
            return balance;
        }
        return BigInteger.zero;
    },

}
