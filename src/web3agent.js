import axios from 'axios';
import { LexModelBuildingService } from '../node_modules/aws-sdk/index.js';
var BigInteger = require('node-biginteger');
var db = require('./db.js');
var util = require('./util');

var contractAddress = '0x517396bD11d750E4417B82F2b0FcFa62a4f2bB96';
var lockContractAddress = '0x824660d0f3BA91FD84ad0D36e45B88189A06326a';

//var myContracts = [contractAddress.toLowerCase(), lockContractAddress.toLowerCase()];
var apiKey = "2BUPCDPXTUMGBGJXMCWDS184B3DRDEC96D";

var serverconfig = require(__dirname + '/../src/config/server-config.json');

class Web3agent
{
    constructor() {
        this.scanHost = serverconfig.SCANHOST;
        this.myContracts = [];
    }

    set(host) {
        this.scanHost = host;
        console.log('web3agent.set(host)', host);
    }

    set_mycontracts(addressList) {
        this.myContracts = addressList;
    }

    scan_logs(from, to, address) {
        return new Promise(async (resolve, reject) => {
            var query = `${this.scanHost}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}&apikey=${apiKey}`;
            try {
                var res = await axios.get(query, {timeout: 2000});
                if (res.data.result.length > 0) {
                    db.insert_eventlog(res.data.result).then((cnt) => {
                        console.log(`[${util.currentTime()}] scan_logs: # of items scanned ${res.data.result.length}, # of rows inserted ${cnt}`);
                        resolve(res.data.result);
                    });
                } else {
                    resolve([]);
                }
            } catch(e) {
                console.log(`scan_logs: ${query}, exception ${e.message}`);
                reject(e);
            }
        });
    }

    recursive_scan_txlist(address, depth) {
        return new Promise(async (resolve, reject) => {
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

            resolve(0);
        });
    }

    scan_txlist(from, to, address, onlyTokenContract) {
        return new Promise(async (resolve, reject) => {
            var query = `${this.scanHost}/api?module=account&action=txlist&startBlock=${from}&endBlock=${to}&address=${address}&apikey=${apiKey}`;
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
            return resolve([0, 0, []]);
        });
    }

    query_token_balance(contract, address) {
        return new Promise(async (resolve, reject) => {
            var query = `${this.scanHost}/api?module=account&action=tokenbalance&contractaddress=${contract}&address=${address}&tag=latest&apikey=${apiKey}`;
            
            var res = await axios.get(query, {});
            if (res.data.result) {
                var balance = BigInteger.fromString(res.data.result);
                resolve(balance);
            } else {
                resolve(BigInteger.zero);
            }
        });
    }

    query_token_balances(contract, addressList) {
        return new Promise(async (resolve, reject) => {
            var query = `${this.scanHost}/api?module=account&action=balancemulti&contractaddress=${contract}&address=${addressList}&tag=latest&apikey=${apiKey}`;
            
            var res = await axios.get(query, {});
            if (res.data.result) {
                resolve(res.data.result);
            } else {
                resolve([]);
            }
        });
    }    
}


module.exports = Web3agent;
