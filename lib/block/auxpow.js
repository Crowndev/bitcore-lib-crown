'use strict';

let MerkleTransaction = require('./merkletransaction');
let Hash = require('../crypto/hash');
let BufferUtil = require('../util/buffer');
let BufferReader = require('../encoding/bufferreader');

class AuxPow extends MerkleTransaction {
  fromBufferReader(reader) {
    super.fromBufferReader(reader);
    let size = reader.readVarintNum();
    this.chainMerkleBranch = []; // merkle branch of aux blockchain link
    for (let i = 0; i < size; i++) {
      this.chainMerkleBranch.push(reader.read(32));
    }
    this.chainMerkleBranchSideMask = reader.readUInt32LE(); // branch sides bitmask

    // This import couldn't be at the top of file due to cyclic problem.
    let BlockHeader = require('./blockheader');

    this.parentBlockHeader = new BlockHeader(reader.read(80));
    return this;
  }

  fromObject(arg) {
    super.fromObject(arg);
    this.chainMerkleBranch = arg.chainMerkleBranch;
    this.chainMerkleBranchSideMask = arg.chainMerkleBranchSideMask;
    this.parentBlockHeader = arg.parentBlockHeader;
    return this;
  }

  toBufferWriterWhole(writer) {
    super.toBufferWriterWhole(writer);
    writer.writeVarintNum(this.chainMerkleBranch.length);
    this.chainMerkleBranch.forEach(m => writer.write(m));
    writer.writeUInt32LE(this.chainMerkleBranchSideMask);
    this.parentBlockHeader.toBufferWriter(writer);
    return writer;
  }

  check(blockHash, chainId) {
    if (this.merkleBranchSideMask !== 0) throw new Error("AuxPow is not a generate.");

    if (this.parentBlockHeader.versionObject.getChainId() === chainId) {
      throw new Error("Parent block's chain ID is the same as ours.");
    }

    let chainRootHash = BufferUtil.reverse(AuxPow._computeMerkleBranch(
      blockHash,
      this.chainMerkleBranch,
      this.chainMerkleBranchSideMask
    ));
    let scriptSig = this.inputs[0]._scriptBuffer;
    let symbolPos = scriptSig.indexOf(AuxPow.SCRIPT_SYMBOL);
    let hashPos = scriptSig.indexOf(chainRootHash);

    if (!BufferUtil.equals(
      AuxPow._computeMerkleBranch(this._getHash(), this.merkleBranch, this.merkleBranchSideMask), this.parentBlockHeader.merkleRoot
    )) throw new Error("Merkle root incorrect.");

    if (hashPos === -1) throw new Error("Chain merkle root not found in parent block coinbase scriptSig.");

    if (symbolPos !== -1) {
      if (scriptSig.indexOf(AuxPow.SCRIPT_SYMBOL, symbolPos + 1) !== -1) throw new Error(
        `Multiple "${AuxPow.SCRIPT_SYMBOL.toString("hex")}" symbols in parent block coinbase scriptSig.`
      );
      if (symbolPos + AuxPow.SCRIPT_SYMBOL.length !== hashPos) throw new Error(
        `"${AuxPow.SCRIPT_SYMBOL.toString("hex")}" symbol is not just before chain merkle root.`
      );
    }
    else {
      if (hashPos > 20) throw new Error(
        "Chain merkle root must start in the first 20 bytes of parent block coinbase scriptSig."
      );
    }

    let sizePos = hashPos + chainRootHash.length;
    if (scriptSig.length - sizePos < 8) throw new Error(
      "Chain merkle tree size and nonce not found in parent block coinbase scriptSig."
    );

    let size = new BufferReader(scriptSig.slice(sizePos, sizePos + 4)).readUInt32LE();
    let merkleHeight = this.chainMerkleBranch.length;
    if (size !== 1 << merkleHeight) throw new Error(
      "Merkle branch size does not match parent block coinbase scriptSig."
    );

    let nonce = new BufferReader(scriptSig.slice(sizePos + 4, sizePos + 8)).readUInt32LE();
    if (
      this.chainMerkleBranchSideMask !==
      AuxPow.getExpectedChainMerkleBranchSideMask(nonce, chainId, merkleHeight)
    ) throw new Error("Wrong chain merkle branch side mask.");
  }

  static _computeMerkleBranch(hash, merkleBranch, sideMask) {
    if (merkleBranch.length > 30) throw new Error("Merkle branch too long.");
    merkleBranch.forEach(item => {
      if (sideMask & 1) {
        hash = Hash.sha256sha256(Buffer.concat([item, hash]));
      }
      else {
        hash = Hash.sha256sha256(Buffer.concat([hash, item]));
      }
      sideMask >>= 1;
    });
    return hash;
  }

  static getExpectedChainMerkleBranchSideMask(nonce, chainId, h) {
    let rand = nonce;
    rand = rand * 1103515245 + 12345;
    rand += chainId;
    rand = rand * 1103515245 + 12345;
    return rand % (1 << h);
  }
}

AuxPow.SCRIPT_SYMBOL = Buffer.from("fabe6d6d","hex");

module.exports = AuxPow;
