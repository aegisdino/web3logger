const web3 = require('web3')
const Web3EthAbi = require('web3-eth-abi');
var bigInt = require("big-integer");

var tokenlocklogs = [];
var app;
var Web3agent = require('./web3agent');

var web3agent = new Web3agent();

var tokenlockmap = new Map();
var db = require('./db.js');
var util = require('./util.js');

const lockContractAddress = '0x824660d0f3BA91FD84ad0D36e45B88189A06326a';

const _lockEventTopic = '0x9e91fc08a6b9ad305ed9692fc37e5c77042b1828c424b7b406bedacaf76aa898';
const _unlockEventTopic = '0xc5cfc121ba9b038fe81c6458a02bc09c797139a3983ae18ad2b68a634297fc27';
const _retrieveEventTopic = '0x9d60f0403eac0553cfce77880fc61018e4c1138b922228fef15350071162f131';

const _lockEventParams = [
	{
		"indexed": false,
		"internalType": "address",
		"name": "_address",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "address",
		"name": "_beneficiary",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "_amount",
		"type": "uint256"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "_releaseTime",
		"type": "uint256"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "index",
		"type": "uint256"
	}
	];

const _retrieveEventParams = [
	{
		"indexed": false,
		"internalType": "address",
		"name": "_address",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "address",
		"name": "_beneficiary",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "_amount",
		"type": "uint256"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "index",
		"type": "uint256"
	}
];

const _unlockEventParams = [
	{
		"indexed": false,
		"internalType": "address",
		"name": "_address",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "address",
		"name": "_beneficiary",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "_amount",
		"type": "uint256"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "mask",
		"type": "uint256"
	}
];

function update_lockstat(lockdata) {
	lockdata.list = lockdata.list.filter(v => v.amount != '');
	lockdata.stat.count = lockdata.list.length;
	lockdata.stat.amount = bigInt();

	lockdata.list.forEach((v) => {
		lockdata.stat.amount += bigInt(v.amount);
	});
	lockdata.stat.amount = lockdata.stat.amount.toString(10);

	lockdata.dirty = true;
}

function parse_lock_event(event, topics) {
	var data = event.data;
	var results = Web3EthAbi.decodeLog(_lockEventParams, data, topics);
	if (results) {
		var lockedAddress = results['1'].toLowerCase();
		// if (lockedAddress == '0x467fa8eb55b375d2ed0c84722b72e63597ef9664')
		// 	console.log('locked', event.txhash, event.blockno, event.timestamp, results);

		db.update_eventlog(event.txhash, event.logindex, lockedAddress, JSON.stringify(results));

		var lockdata = tokenlockmap.get(lockedAddress);
		if (!lockdata) {
			lockdata = { stat: { address: lockedAddress, amount: bigInt(), count: 0, regdate: event.timestamp }, list: [] };
			tokenlockmap.set(lockedAddress, lockdata);
		}

		lockdata.list.push({ 
			amount : results['2'], relasetime : parseInt(results['3']), ownerAddress : results['0'], slot : parseInt(results['4']) 
		});

		update_lockstat(lockdata);
	} else {
		console.log('parse_lock_event: fail to decode log');
	}
}

// unlock은 마스크를 이용해서 처리
async function parse_unlock_event(event, topics) {
	var data = event.data;
	var results = Web3EthAbi.decodeLog(_unlockEventParams, data, topics);
	if (results) {
		var lockedAddress = results['1'].toLowerCase();
		// if (lockedAddress == '0x467fa8eb55b375d2ed0c84722b72e63597ef9664')
		// 	console.log('unlocked', results, event);

		db.update_eventlog(event.txhash, event.logindex, lockedAddress, JSON.stringify(results));
		
		var lockdata = tokenlockmap.get(lockedAddress);
		if (lockdata) {
			// 3번은 비트 마스크
			var slotmask = (1 << parseInt(results['3']));
			for (var i = 0; i < lockdata.list.length; i++) {
				if (((1 << lockdata.list[i].slot) & slotmask) != 0) {
					if (lockdata.list[i])
						lockdata.list[i].amount = '';
				}
			}

			update_lockstat(lockdata);
		}
	} else {
		console.log('parse_unlock_event: fail to decode log');
	}
}

// retrieve는 특정 슬롯을 직접 회수
function parse_retrieve_event(event, topics) {
	var data = event.data;
	var results = Web3EthAbi.decodeLog(_retrieveEventParams, data, topics);
	if (results) {
		var lockedAddress = results['1'].toLowerCase();
		// if (lockedAddress == '0x467fa8eb55b375d2ed0c84722b72e63597ef9664')
		// 	console.log('released', event.txhash, event.blockno, event.timestamp, results);		

		db.update_eventlog(event.txhash, event.logindex, lockedAddress, JSON.stringify(results));

		var lockdata = tokenlockmap.get(lockedAddress);
		if (lockdata) {
			// 3번은 슬롯 번호
			var index = parseInt(results['3']);
			var removed_index = -1;
			for (var i = 0; i < lockdata.list.length; i++) {
				if (lockdata.list[i].slot == index) {
					lockdata.list[i].amount = '';
					removed_index = i;
				}
			}

			// if (removed_index == -1)
			// 	console.log(`parse_retrieve_event: slot ${index} has no data`, event.txhash, event.blockno, event.timestamp, results);

			update_lockstat(lockdata);
		}
	} else {
		console.log('parse_retrieve_event: fail to decode log');
	}
}

function parse_token_lock_logs(newlogs) {
	for (var i = 0; i < newlogs.length; i++) {
		var event = newlogs[i];

		var topics = [event.topics0];
		if (event.topics1) topics.push(event.topics1);
		if (event.topics2) topics.push(event.topics2);
		if (event.topics3) topics.push(event.topics3);

		if (event.topics0 == _lockEventTopic) {
			parse_lock_event(event, topics);
		} else if (event.topics0 == _retrieveEventTopic) {
			parse_retrieve_event(event, topics);	
		} else if (event.topics0 == _unlockEventTopic) {
			parse_unlock_event(event, topics);	
		} else {
			console.log('no matched topic', event.topics0);
		}
	}
}

var load_logs_count = 0;

async function updata_dirty_lockstats() {
	var updatedata = [];
	var updatedata = [];

	for (var entry of tokenlockmap.entries()) {
		if (entry[1].dirty) {
			entry[1].dirty = false;
			updatedata.push([entry[0], JSON.stringify(entry[1]), Math.round(bigInt(entry[1].stat.amount)/bigInt(1e+18)), new Date(entry[1].stat.regdate * 1000).toISOString()]);
		}
	}

	if (updatedata.length > 0)
		await db.update_tokenlockstats(updatedata);
}

function get_lockstats() {
	var totalAmount =  bigInt();
	var lockCount = 0;

	var datemap = new Map();

	for (var entry of tokenlockmap.entries()) {
		if (entry[1].stat.count > 0) {
			var amount = Math.round(bigInt(entry[1].stat.amount)/bigInt(1e+18));

			lockCount++;
			totalAmount += amount;

			var regdate = (new Date(entry[1].stat.regdate * 1000)).toISOString().split('T')[0];
			var dayinfo = datemap.get(regdate);
			if (dayinfo) {
				dayinfo.count++;
				dayinfo.amount += amount;
			}
			else {
				datemap.set(regdate, { count: 1, amount: amount } );
			}
		}
	}

	let dailystat = {};
    datemap.forEach(function(value, key){
        dailystat[key] = value
    });

	var result = {
		addresscount : tokenlockmap.size, 
		lockaddresscount: lockCount,
		totalamount: totalAmount, 
		dailystat: dailystat
	};

	return result;
  }

async function load_logs() {
	// 네트워크가 과밀 상태일 때는 같은 블록 정보도 나중에 쓰여지는 경우가 존재함
	var next_block_offset = 1;
	var total_scan_count = 0;

	// 전체 스탯 로딩
	if (load_logs_count++ == 0) {
		var rows = await db.load_all_tokenlockstats();
		for (var i = 0; i < rows.length; i++) {
			tokenlockmap.set(rows[i].address, JSON.parse(rows[i].lockdata));
		}

		console.log(`[${util.currentTime()}] load_logs: tokenlock # in DB ${rows.length}`);

		// load data from db
		var eventlogs = await db.load_eventlog(lockContractAddress, "id", 0);	
		if (eventlogs.length > 0) {
			tokenlocklogs.push(...eventlogs);

			// 디비에 빌딩된 게 없으면 로그를 이용하여 빌드
			if (tokenlockmap.size == undefined || tokenlockmap.size == 0) {
				parse_token_lock_logs(eventlogs);
			}
		}

		console.log(`[${util.currentTime()}] load_logs: eventlogs # in DB ${eventlogs.length}`);

		console.log(get_lockstats());
	}

	// 스캔데이터가 1000개가 넘는 경우는 루프를 돌게 되며
	// 그렇지 않으면 바로 끝남
	for (var i = 0; i < 10; i++) {
		var scan_count = 0;
		var last_blockno = tokenlocklogs.length == 0 ? 0 : (tokenlocklogs[tokenlocklogs.length-1].blockno + next_block_offset);
		try {
			var newlogs = await web3agent.scan_logs(last_blockno, 'latest', lockContractAddress);
			if (newlogs.length > 0) {
				scan_count = newlogs.length;
				total_scan_count += scan_count;
				console.log(`[${util.currentTime()}] load_logs: scanned #${scan_count}`);
			}

			var last_dbid = tokenlocklogs.length == 0 ? 0 : tokenlocklogs[tokenlocklogs.length-1].id;
			var eventlogs = await db.load_eventlog(lockContractAddress, "id", last_dbid);
			if (eventlogs.length > 0) {
				if (newlogs.length == 0)
					console.log(`[${util.currentTime()}] load_logs: not scanned but data #${eventlogs.length} loaded from db`);
				tokenlocklogs.push(...eventlogs);
				parse_token_lock_logs(eventlogs);
				console.log(`[${util.currentTime()}] load_logs: from db #${eventlogs.length}, last_dbid ${last_dbid}`);
			}

			next_block_offset = 0;
		} catch(e) {
			continue;
		}
		
		if (scan_count < 1000) break;
	}

	// lockstat 디비에 flush
	await updata_dirty_lockstats();
	
	if (total_scan_count > 0 || (load_logs_count % 100) == 0) {
		console.log(`[${util.currentTime()}] load_logs: eventlogs ${tokenlocklogs.length}, lock account # ${tokenlockmap.size}, collected ${total_scan_count}`);
		console.log(get_lockstats());
	}

	// 1초 후에 다시 시작
	setTimeout(load_logs, 1000);
}

module.exports = {
  async start(_app) {
    app = _app;

	console.log('start tokenlockmgr');
	await load_logs();
  },

  find(address) {
    return tokenlockmap.get(address);
  },

  get_topic0(topic0) {
    if (topic0 == _lockEventTopic) return 'lock';
    else if (topic0 == _unlockEventTopic) return 'lock';
    else if (topic0 == _retrieveEventTopic) return 'retrieve';
    return '';
  },

  get_lockstats() {
	return get_lockstats();
  }
}

