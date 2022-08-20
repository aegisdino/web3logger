const moment = require('moment');
const Web3 = require('web3');
const Web3agent = require('./web3agent');
const BigInteger = require("big-integer");

var db = require('./db.js');
var util = require('./util.js');
const e = require('express');

var web3agent = new Web3agent();
var web3 = new Web3();

var tokenHolderMap = new Map();

var serverconfig = require(__dirname + '/../src/config/server-config.json');

var contractAddress = '0x517396bD11d750E4417B82F2b0FcFa62a4f2bB96';

const _TransferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const _transferEventParams = [
	{
		"indexed": true,
		"internalType": "address",
		"name": "from",
		"type": "address"
	},
	{
		"indexed": true,
		"internalType": "address",
		"name": "to",
		"type": "address"
	},
	{
		"indexed": false,
		"internalType": "uint256",
		"name": "value",
		"type": "uint256"
	}
];

var token_transfer_subscription;
var token_transfer_event_received = false;

function subscribe_token_transfer() {
	token_transfer_subscription = web3.eth.subscribe('logs', {
	    address: contractAddress,
    	topics: [_TransferEventTopic]}, function(error, result) {
    	if (!error) {
			token_transfer_event_received = true;
    	    console.log('subscribe_token_transfer', result);
		}
	});
}

function unsubscribe_token_transfer() {
	if (token_transfer_subscription) {
		// unsubscribes the subscription
		token_transfer_subscription.unsubscribe(function(error, success){
			if(success)
				console.log('Successfully unsubscribed!');
		});
		token_transfer_subscription = null;
	}
}

function update_token_balance(address, amount, date, isSend) {
	var holder = tokenHolderMap.get(address);
	if (holder) {
		var oldBalance = holder.balance;
		if (isSend)
			holder.balance = holder.balance - amount;
		else
			holder.balance = holder.balance + amount;

		//console.log(address, oldBalance.toString(), holder.balance.toString(), amount.toString(), isSend);

		holder.updatedate = date;
		holder.dirty =  true;
	} else if (!isSend) {
		holder = { 
			balance : amount, 
			lockamount: 0, 
			regdate: date, 
			dirty: true 
		};
		tokenHolderMap.set(address, holder);
	}

	// if (address == '0xd36a5b648c2fde96318145df14319a2be1e83e26')
	// 	console.log(holder, amount.toString(), isSend);
}

async function load_token_holders() {
	var rows = await db.load_all_tokenholders(contractAddress);
	for (var i = 0; i < rows.length; i++) {
		tokenHolderMap.set(rows[i].address, { 
			balance : BigInteger(rows[i].balance), 
			lockamount: rows[i].lockamount, 
			regdate: rows[i].regdate, 
			updatedate: rows[i].updatedate, 
			dirty: false 
		} );
	}	
}

async function updata_dirty_holders() {
	var updatedata = [];

	for (var entry of tokenHolderMap.entries()) {		
		if (entry[1].dirty) {
			entry[1].dirty = false;

			updatedata.push([
				contractAddress,
				entry[0],
				entry[1].balance,
				0,
				new Date(entry[1].regdate).toISOString(), 
				entry[1].updatedate != null ? new Date(entry[1].updatedate).toISOString() : null, 
			]);
		}
	}

	if (updatedata.length > 0)
		await db.update_tokenholders(updatedata);
}

function parse_token_logs(newlogs) {
	for (var i = 0; i < newlogs.length; i++) {
		var event = newlogs[i];
		var topics;

		if (event.topics) {
			topics = event.topics;
			event.topics0 = topics[0];
			if (topics.length > 1)
				event.topics1 = topics[1];
			if (topics.length > 2)
				event.topics2 = topics[2];
			if (topics.length > 3)
				event.topics3 = topics[3];
		} else {
			topics = [event.topics0];
			if (event.topics1) topics.push(event.topics1);
			if (event.topics2) topics.push(event.topics2);
			if (event.topics3) topics.push(event.topics3);
		}

		//console.log('parse_token_logs', event, _TransferEventTopic);

		if (event.topics0 == _TransferEventTopic) {
			try {
				parse_transfer_event(event, topics);
			} catch(e) {
				console.log('parse_token_logs', e);
			}
		} else {
			console.log('parse_token_logs: unknown topic', event.topics0);
		}
	}
}

function parse_transfer_event(event, topics) {
	try {
		var fromAddress = '0x' + topics[1].slice('0x000000000000000000000000'.length);
		var toAddress = '0x' + topics[2].slice('0x000000000000000000000000'.length);
		var amount = BigInteger(event.data.slice(2), 16);
		var date = new Date(Number(event.timeStamp) * 1000);	

		//console.log('parse_transfer_event', fromAddress, toAddress, amount.toString(), date.toISOString());
		if (fromAddress != '0x0000000000000000000000000000000000000000')
			update_token_balance(fromAddress, amount, date, true);
		update_token_balance(toAddress, amount, date, false);
	} catch(e) {
		console.log('parse_transfer_event', e);
	}
}

var load_logs_count = 0;
var last_blockno = 0;

async function scan_holders_event_periodic() {
	// 네트워크가 과밀 상태일 때는 같은 블록 정보도 나중에 쓰여지는 경우가 존재함
	var next_block_offset = 1;
	var total_scan_count = 0;

	// 전체 스탯 로딩
	if (load_logs_count++ == 0) {
		await load_token_holders();

		// load data from db
		last_blockno = await db.load_lasttxid(contractAddress);	

		console.log(`[${util.currentTime()}] scan_holders_event_periodic: last_blockno in DB ${last_blockno}`);
	} else {
		if (!token_transfer_event_received) 
			return;
		console.log(`[${util.currentTime()}] scan_holders_event_periodic: token event exists`);
	}

	var alllogs = [];
	
	// 스캔데이터가 1000개가 넘는 경우는 루프를 돌게 되며
	// 그렇지 않으면 바로 끝남
	for (var loopcount = 0; loopcount < 100; loopcount++) {
		var scan_count = 0;
		try {
			var newlogs = await web3agent.scan_logs(last_blockno + next_block_offset, 'latest', contractAddress, _TransferEventTopic);
			if (newlogs.length > 0) {
				for (var i = 0; i < newlogs.length; i++) {
					var found = alllogs.find((item) => { return item.blockNumber == newlogs[i].blockNumber && item.logIndex == newlogs[i].logIndex; });
					if (!found) 
						alllogs.push(newlogs[i]);
				}

				scan_count = newlogs.length;
				total_scan_count += scan_count;
				last_blockno = Number(newlogs[newlogs.length-1].blockNumber);

				console.log(`[${util.currentTime()}] scan_holders_event_periodic: [${loopcount}] scanned #${scan_count}, last_blockno ${last_blockno}`);
			}
			next_block_offset = 0;
		} catch(e) {
			console.log('scan_holders_event_periodic', e);
			continue;
		}
		
		if (scan_count < 1000) break;
	}

	if (alllogs.length > 0)
		parse_token_logs(alllogs);

	// 5초 후에 다시 시작
	setTimeout(scan_holders_event_periodic, serverconfig.SCANPERIOD || 5000);

	if (total_scan_count > 0) {
		db.insert_lasttxid(contractAddress, last_blockno);	

		updata_dirty_holders();
		token_transfer_event_received = false;
	}
}

module.exports = {
  async start(address) {
	console.log('start token balance manager', address);

	contractAddress = address.toLowerCase();
	
	await scan_holders_event_periodic();

	subscribe_token_transfer();
  },

  find(address) {
    return tokenHolderMap.get(address);
  },

}

