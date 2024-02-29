// Types
import { JsonRpcLog } from "./log.ts";
import { JsonRpcReceipt } from "./receipt.ts";

// Eth
import { JsonRpcBlock, JsonRpcTx } from "../deps.ts";

type Collection =
  | "transactions"
  | "logs"
  | "receipts"
  | "headers";

export type StoreItem<C = Collection> = {
  collection: C;
  data: C extends "transactions" ? { tx: JsonRpcTx, createdAt: Date }
    : C extends "logs" ? { log: JsonRpcLog, createdAt: Date }
    : C extends "receipts" ? { receipt: JsonRpcReceipt, createdAt: Date }
    : { header: JsonRpcBlock, createdAt: Date };
};
