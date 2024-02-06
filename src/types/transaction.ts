// Utils
import { padBytes } from "../utils/hex.ts";

// Starknet
import {
  bigIntToHex,
  Transaction,
  TransactionReceipt,
  uint256,
} from "../deps.ts";

// Eth
import {
  AccessListEIP2930Transaction,
  bigIntToBytes,
  concatBytes,
  FeeMarketEIP1559Transaction,
  intToHex,
  isAccessListEIP2930Tx,
  isFeeMarketEIP1559TxData,
  isLegacyTx,
  JsonRpcTx,
  LegacyTransaction,
  PrefixedHexString,
  TransactionFactory,
  TypedTransaction,
  TypedTxData,
} from "../deps.ts";

/**
 * @param transaction - Typed transaction to be converted.
 * @param header - The block header of the block containing the transaction.
 * @param receipt The transaction receipt of the transaction.
 * @param blockNumber - The block number of the transaction in hex.
 * @param blockHash - The block hash of the transaction in hex.
 * @returns - The transaction in the Ethereum format, or null if the transaction is invalid.
 * @throws - Error if any function throws a non-Error.
 *
 * Acknowledgement: Code taken from <https://github.com/ethereumjs/ethereumjs-monorepo>
 */
export function toEthTx({
  transaction,
  receipt,
  blockNumber,
  blockHash,
}: {
  transaction: TypedTransaction;
  receipt: TransactionReceipt;
  blockNumber: PrefixedHexString;
  blockHash: PrefixedHexString;
}): JsonRpcTx | null {
  const index = receipt.transactionIndex;

  if (index === undefined) {
    console.error(
      "Known bug (apibara): ⚠️ Transaction index is undefined - Transaction index will be set to 0.",
    );
  }

  const txJSON = transaction.toJSON();
  if (
    txJSON.r === undefined ||
    txJSON.s === undefined ||
    txJSON.v === undefined
  ) {
    console.error(
      `Transaction is not signed: {r: ${txJSON.r}, s: ${txJSON.s}, v: ${txJSON.v}}`,
    );
    // TODO: Ping alert webhooks
    return null;
  }
  return {
    blockHash,
    blockNumber,
    from: transaction.getSenderAddress().toString(),
    gas: txJSON.gasLimit!,
    gasPrice: txJSON.gasPrice ?? txJSON.maxFeePerGas!,
    maxFeePerGas: txJSON.maxFeePerGas,
    maxPriorityFeePerGas: txJSON.maxPriorityFeePerGas,
    type: intToHex(transaction.type),
    accessList: txJSON.accessList,
    chainId: txJSON.chainId,
    hash: padBytes(transaction.hash(), 32),
    input: txJSON.data!,
    nonce: txJSON.nonce!,
    to: transaction.to?.toString() ?? null,
    transactionIndex: bigIntToHex(BigInt(index ?? 0)),
    value: txJSON.value!,
    v: txJSON.v,
    r: txJSON.r,
    s: txJSON.s,
    maxFeePerBlobGas: txJSON.maxFeePerBlobGas,
    blobVersionedHashes: txJSON.blobVersionedHashes,
  };
}

/**
 * @param transaction - A Kakarot transaction.
 * @returns - The Typed transaction in the Ethereum format
 */
export function toTypedEthTx({
  transaction,
}: {
  transaction: Transaction;
}): TypedTransaction | null {
  const calldata = transaction.invokeV1?.calldata;
  if (!calldata) {
    console.error("No calldata");
    return null;
  }
  const callArrayLen = BigInt(calldata[0]);
  // Multi-calls are not supported for now.
  if (callArrayLen !== 1n) {
    console.error(`Invalid call array length ${callArrayLen}`);
    return null;
  }

  // callArrayLen <- calldata[0]
  // to <- calldata[1]
  // selector <- calldata[2];
  // dataOffset <- calldata[3]
  // dataLength <- calldata[4]
  // calldataLen <- calldata[5]
  const bytes = concatBytes(
    ...calldata.slice(6).map((x) => bigIntToBytes(BigInt(x))),
  );

  const signature = transaction.meta.signature;
  if (signature.length !== 5) {
    console.error(`Invalid signature length ${signature.length}`);
    return null;
  }
  const r = uint256.uint256ToBN({ high: signature[1], low: signature[0] });
  const s = uint256.uint256ToBN({ high: signature[3], low: signature[2] });
  const v = BigInt(signature[4]);

  try {
    const ethTxUnsigned = TransactionFactory.fromSerializedData(bytes, {
      freeze: false,
    });
    return addSignature(ethTxUnsigned, r, s, v);
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Invalid transaction: ${e.message}`);
    } else {
      console.error(`Unknown throw ${e}`);
      throw e;
    }
    // TODO: Ping alert webhooks
    return null;
  }
}

/**
 * @param tx - Typed transaction to be signed.
 * @param r - Signature r value.
 * @param s - Signature s value.
 * @param v - Signature v value. In case of EIP155ReplayProtection, must include the chain ID.
 * @returns - Passed transaction with the signature added.
 * @throws - Error if the transaction is a BlobEIP4844Tx or if v param is < 35 for a
 *         LegacyTx.
 */
function addSignature(
  tx: TypedTransaction,
  r: bigint,
  s: bigint,
  v: bigint,
): TypedTransaction {
  const TypedTxData = ((): TypedTxData => {
    if (isLegacyTx(tx)) {
      if (v < 35) {
        throw new Error(`Invalid v value: ${v}`);
      }
      return LegacyTransaction.fromTxData({
        nonce: tx.nonce,
        gasPrice: tx.gasPrice,
        gasLimit: tx.gasLimit,
        to: tx.to,
        value: tx.value,
        data: tx.data,
        v,
        r,
        s,
      });
    } else if (isAccessListEIP2930Tx(tx)) {
      return AccessListEIP2930Transaction.fromTxData({
        chainId: tx.chainId,
        nonce: tx.nonce,
        gasPrice: tx.gasPrice,
        gasLimit: tx.gasLimit,
        to: tx.to,
        value: tx.value,
        data: tx.data,
        accessList: tx.accessList,
        v,
        r,
        s,
      });
    } else if (isFeeMarketEIP1559TxData(tx)) {
      return FeeMarketEIP1559Transaction.fromTxData({
        chainId: tx.chainId,
        nonce: tx.nonce,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        maxFeePerGas: tx.maxFeePerGas,
        gasLimit: tx.gasLimit,
        to: tx.to,
        value: tx.value,
        data: tx.data,
        accessList: tx.accessList,
        v,
        r,
        s,
      });
    } else {
      throw new Error(`Invalid transaction type: ${tx}`);
    }
  })();

  return TransactionFactory.fromTxData(TypedTxData);
}
