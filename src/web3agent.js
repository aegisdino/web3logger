import axios from 'axios';
var BigInteger = require('node-biginteger');
var db = require('./db.js');
var util = require('./util');
var Web3 = require('web3');

var contractAddress = '0x517396bD11d750E4417B82F2b0FcFa62a4f2bB96';
var lockContractAddress = '0x824660d0f3BA91FD84ad0D36e45B88189A06326a';

var myContracts = [contractAddress.toLowerCase(), lockContractAddress.toLowerCase()];
var apiKey = "2BUPCDPXTUMGBGJXMCWDS184B3DRDEC96D";

var serverconfig = require(__dirname + '/../src/config/server-config.json');

var tokenLockArtifact = require(__dirname + '/../src/data/TokenLock.json');

class Web3agent
{
    constructor() {
        this.scanHost = serverconfig.SCANHOST;
        this.myContracts = [];

        this.web3 = new Web3(new Web3.providers.HttpProvider(serverconfig.RPCURL));
        this.tokenLockContract = new this.web3.eth.Contract(tokenLockArtifact.abi, lockContractAddress);
    }

    set(host) {
        this.scanHost = host;
        console.log('web3agent.set(host)', host);
    }

    set_mycontracts(addressList) {
        this.myContracts = addressList;
    }

    scan_logs(from, to, address, topic0) {
        return new Promise(async (resolve, reject) => {
            var query = `${this.scanHost}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=${to}&address=${address}&apikey=${apiKey}`;
            if (topic0)
                query += '&topic0=' + topic0;
            try {
                var res = await axios.get(query, {timeout: 10000});
                if (res.data.result.length > 0) {
                    db.insert_eventlog(res.data.result).then((cnt) => {
                        console.log(`[${util.currentTime()}] scan_logs: # of items scanned ${res.data.result.length}, # of rows inserted ${cnt}`);
                        resolve(res.data.result);
                    }).catch((e) => {
                        console.log(`[${util.currentTime()}] scan_logs: insert_eventlog exception ${e}`);
                        reject(e);
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

    async scan_tokencontract_txlist(address) {
        return new Promise(async (resolve) => {
            var lastid = await db.get_last_contract_txlist(address);
            console.log(`scan_tokencontract_txlist: ${address}, ${lastid}`);

            var results = await this.scan_txlist(lastid+1, 'latest', address, true);
            var addresslist = results[2];
            if (results[0] == 1000) {
                var lastid = results[1];
                for (var trycount = 0; trycount < 1000; trycount++) {
                    var nextresults = await this.scan_txlist(lastid+1, 'latest', address, true);
                    if (nextresults[0] < 1000) break;
                    lastid = nextresults[1];
                    addresslist.push(nextresults[2].filter(v => addresslist.indexOf(v) == -1));
                }
            }

            resolve(0);
        });
    }

    async scan_txlist(from, to, address, onlyTokenContract) {
        return new Promise(async (resolve) => {
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
                    var txlogs = results[3];

                    console.log(`${txlist.length} items inserted [lastblockno ${lastblockno}, new address # ${addresslist.length}, txlogs # ${txlogs.length}]`);
                    return resolve([txlist.length, lastblockno, addresslist, txlogs]);
                }
            } 
            
            await db.insert_token_holder(address, 0, 0, 0);
            return resolve([0, 0, [], []]);
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

    //web3agent.query_lock_info('e45a45ac626af21809a77eedc22ac6b84e111e46', '0x590d8a8ebfdd0ca9748c7410a64584909d4ad6b4');
    async query_lock_info(ownerAddress, beneficiary) {
        var lockinfo = await this.tokenLockContract.methods.lockMap(ownerAddress, beneficiary).call();
        console.log('query_lock_info', ownerAddress, beneficiary, lockinfo[0], lockinfo[1]);
    }
}


module.exports = Web3agent;
