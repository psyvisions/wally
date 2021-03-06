require('classtool');

function ClassSpec(b) {
	var fs = require('fs');
	var Block = require('libcoin/Block');
	var Deserialize = require('libcoin/Deserialize');

	function HeaderDB(b) {
		this.network = b.network;
		this.fd = null;
		this.blocks = {};
		this.bestBlock = null;
	};

	HeaderDB.prototype.locator = function(block) {
		if (!block)
			block = this.bestBlock;

		var step = 1;
		var loc = [];
		while (block) {
			loc.push(block.calcHash());

			for (var i = 0; block && i < step; i++)
				block = block.prev;
			if (loc.length > 10)
				step *= 2;
		}

		loc.push(this.network.genesisBlock.hash.toString());
	};

	HeaderDB.prototype.add = function(block) {
		var hash = block.calcHash();
		var hashStr = hash.toString();
		var prevHashStr = block.prev_hash.toString();
		var curWork = Deserialize.intFromCompact(block.bits);

		if (hashStr in this.blocks)
			throw new Error("duplicate block");

		var bestChain = false;

		var reorg = {
			oldBest: null,
			conn: 0,
			disconn: 0,
		};

		if (this.blocks.length == 0) {
			if (this.network.genesisBlock.hash.toString() !=
			    hashStr)
				throw new Error("Invalid genesis block");

			block.prev = null;
			block.height = 0;
			block.work = curWork;
			bestChain = true;
		} else {
			var prevBlock = this.blocks[prevHashStr];
			if (!prevBlock)
				throw new Error("orphan block; prev not found");

			block.prev = prevBlock;
			block.height = prevBlock.height + 1;
			block.work = prevBlock.work + curWork;

			if (block.work > this.bestBlock.work)
				bestChain = true;
		}

		// add to by-hash index
		this.blocks[hashStr] = block;

		if (bestChain) {
			var oldBest = this.bestBlock;
			var newBest = block;

			reorg.oldBest = oldBest;

			// likely case: new best chain has greater height
			if (!oldBest) {
				while (newBest) {
					newBest = newBest.prev;
					reorg.conn++;
				}
			} else {
				while (newBest &&
				       (newBest.height > oldBest.height)) {
					newBest = newBest.prev;
					reorg.conn++;
				}
			}

			// unlikely: old best chain has greater height
			while (oldBest && newBest &&
			       (oldBest.height > newBest.height)) {
				oldBest = oldBest.prev;
				reorg.disconn++;
			}

			// height matches, but still walking parallel
			while (oldBest && newBest && (oldBest != newBest)) {
				newBest = newBest.prev;
				reorg.conn++;

				oldBest = oldBest.prev;
				reorg.disconn++;
			}

			// reorg analyzed, updated best-chain pointer
			this.bestBlock = block;
		}

		return reorg;
	};

	HeaderDB.prototype.addBuf = function(buf) {
		var block = new Block();
		block.parseHeader(buf);
		this.add(block);
	};

	HeaderDB.prototype.readFile = function(filename) {
		var fd = fs.openSync(filename, 'r');
		var stats = fs.fstatSync(fd);
		if (stats.size % 80 != 0)
			throw new Error("Corrupted header db");

		while (1) {
			var buf = new Buffer(80);
			var bread = fs.readSync(fd, buf, 0, 80, null);
			if (bread < 80)
				break;

			this.addBuf(buf);
		}

		fs.closeSync(fd);
	};

	HeaderDB.prototype.writeFile = function(filename) {
		var block = this.bestBlock;
		var data = [];
		while (block) {
			var s = block.getHeader();
			data.push(s);
			block = block.prev;
		}

		data.reverse();

		var fd = fs.openSync(filename, 'w');

		data.foreach(function(datum) {
			fs.writeSync(fd, datum, 0, 80, null);
		});

		fs.closeSync(fd);
	};

	return HeaderDB;
};
module.defineClass(ClassSpec);

