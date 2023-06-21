import { JsonRpcRequest } from "@walletconnect/jsonrpc-utils";

import { BLOCKCHAIN_LOGO_BASE_URL } from "../constants";

import {
  NamespaceMetadata,
  ChainMetadata,
  ChainRequestRender,
  ChainsMap,
} from "../helpers";

export const BchChainData: ChainsMap = {
  "bitcoincash": {
    name: "BCH Mainnet",
    id: "bch:bitcoincash",
    rpc: ["https://rpc.cosmos.network"],
    slip44: 145,
    testnet: false,
  },
  "bchtest": {
    name: "BCH Chipnet",
    id: "bch:bchtest",
    rpc: ["https://rpc.irisnet.org"],
    slip44: 145,
    testnet: true,
  },
};

export const CosmosMetadata: NamespaceMetadata = {
  "bitcoincash": {
    logo: BLOCKCHAIN_LOGO_BASE_URL + "cosmos:cosmoshub-4.png",
    rgb: "27, 31, 53",
  },
};

export function getChainMetadata(chainId: string): ChainMetadata {
  const reference = chainId.split(":")[1];
  const metadata = CosmosMetadata[reference];
  if (typeof metadata === "undefined") {
    throw new Error(`No chain metadata found for chainId: ${chainId}`);
  }
  return metadata;
}

export function getChainRequestRender(
  request: JsonRpcRequest
): ChainRequestRender[] {
  let params = [{ label: "Method", value: request.method }];

  switch (request.method) {
    default:
      params = [
        ...params,
        {
          label: "params",
          value: JSON.stringify(request.params, null, "\t"),
        },
      ];
      break;
  }
  return params;
}
