const web3 = require('web3')
const Web3EthAbi = require('web3-eth-abi');
var bigInt = require("big-integer");
var serverconfig = require(__dirname + '/../src/config/server-config.json');

var nftlogs = [];
var usernftmap = new Map();	// user에 대해서 nftlist를 세팅
var nftusermap = new Map();	// nft에 대해서 user를 세팅

var app;

// nft는 테스트넷 지정
var Web3agent = require('./web3agent');

var web3agent = new Web3agent();
web3agent.set(serverconfig.TESTSCANHOST);

var db = require('./db.js');
var util = require('./util');

const nftContractAddress = '0xDC00E379C0861312234A374bfeE5947800B463D2'.toLowerCase();
const zero_address = '0x0000000000000000000000000000000000000000';

const _transferEventTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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
		"internalType": "uint256",
		"name": "tokenId",
		"type": "uint256"
	}
];

// var from = '0x'+topics[1].substring(26);
// var to = '0x'+topics[2].substring(26);
// var tokenId = parseInt(topics[3]);

function parse_transfer_event(tokenaddress, event, topics) {
	var data = event.data;
	var results = Web3EthAbi.decodeLog(_transferEventParams, data, topics);
	if (results) {
		var from = results['1'].toLowerCase();
		var to = results['2'].toLowerCase();
		var tokenId = parseInt(results['3']);

		console.log(from, to, tokenId);
	
		var tokenKey = `${tokenaddress}.${tokenId}`;
		var minted = false;
		
		if (from != '0x0000000000000000000000000000000000000000') {
			var fromnft = usernftmap.get(from);
			if (fromnft)
				fromnft.remove(tokenKey);
		} else {
			minted = true;
		}
		insert_nft_to_user(to, tokenKey);

		db.update_nft_owner(tokenaddress, tokenId, to, minted ? event.timestamp : undefined);
	}
}

function insert_nft_to_user(owner, tokenKey) {
	var usernfts =  usernftmap.get(owner);
	if (usernfts)
		usernfts.push(tokenKey);
	else
		usernftmap.set(owner, [tokenKey]);
	nftusermap.set(tokenKey, owner);
}

function parse_nft_logs(tokenaddress, newlogs) {
	for (var i = 0; i < newlogs.length; i++) {
		var event = newlogs[i];

		var topics = [event.topics0];
		if (event.topics1) topics.push(event.topics1);
		if (event.topics2) topics.push(event.topics2);
		if (event.topics3) topics.push(event.topics3);

		if (event.topics0 == _transferEventTopic) {
			parse_transfer_event(tokenaddress, event, topics);
		} 
	}
}

var load_logs_count = 0;

async function load_logs() {
	// 네트워크가 과밀 상태일 때는 같은 블록 정보도 나중에 쓰여지는 경우가 존재함
	var next_block_offset = 1;
	var total_scan_count = 0;

	// 전체 스탯 로딩
	if (load_logs_count++ == 0) {
		var rows = await db.load_all_nfts();
		for (var i = 0; i < rows.length; i++) {
			var tokenKey = `${rows[i].nftaddress}.${rows[i].tokenid}`;
			insert_nft_to_user(rows[i].owner, tokenKey);
		}

		console.log(`[${util.currentTime()}] load_logs(nft): nfts # in DB ${rows.length}`);

		// load data from db
		var eventlogs = await db.load_eventlog(nftContractAddress, "id", 0);	
		if (eventlogs.length > 0) {
			nftlogs.push(...eventlogs);

			// 디비에 빌딩된 게 없으면 로그를 이용하여 빌드
			if (nftusermap.size == undefined || nftusermap.length == 0)
				parse_nft_logs(nftContractAddress, eventlogs);
		}

		console.log(`[${util.currentTime()}] load_logs(nft): eventlogs # in DB ${eventlogs.length}`);
	}

	// 스캔데이터가 1000개가 넘는 경우는 루프를 돌게 되며
	// 그렇지 않으면 바로 끝남
	for (var i = 0; i < 10; i++) { // 10번돌자
		var scan_count = 0;
		var last_blockno = nftlogs.length == 0 ? 0 : (nftlogs[nftlogs.length-1].blockno + next_block_offset);
		try {
			var newlogs = await web3agent.scan_logs(last_blockno, 'latest', nftContractAddress);
			if (newlogs.length > 0) {
				scan_count = newlogs.length;
				total_scan_count += scan_count;

				console.log(`[${util.currentTime()}] load_logs(nft): scaned #${scan_count}`);

				var last_dbid = nftlogs.length == 0 ? 0 : nftlogs[nftlogs.length-1].id;
				var eventlogs = await db.load_eventlog(nftContractAddress, "id", last_dbid);
				if (eventlogs.length > 0) {
					nftlogs.push(...eventlogs);
					parse_nft_logs(eventlogs);
				}
				console.log(`[${util.currentTime()}] load_logs(nft): from db #${eventlogs.length}`);

				next_block_offset = 0;
			}
		} catch(e) {
			continue;
		}
		
		if (scan_count < 1000) break;
	}


	if (total_scan_count > 0 || (load_logs_count % 100) == 0) {
		console.log(`[${util.currentTime()}] load_logs(nft): eventlogs ${nftlogs.length}, nft# ${nftusermap.size}, collected ${total_scan_count}`);
	}

	// 1초 후에 다시 시작
	setTimeout(load_logs, 1000);
}

module.exports = {
  async start(_app) {
    app = _app;

	console.log('start nftlogger');
	await load_logs();
  },

  find(owner) {
    return usernftmap.get(owner);
  },

  find(tokenaddress, tokenId) {
	var tokenKey = `${tokenaddress}.${tokenId}`;
	return nftusermap.get(tokenKey);
  }
}

