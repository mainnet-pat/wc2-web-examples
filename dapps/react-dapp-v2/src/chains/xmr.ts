import { JsonRpcRequest } from "@walletconnect/jsonrpc-utils";

import { BLOCKCHAIN_LOGO_BASE_URL } from "../constants";

import {
  NamespaceMetadata,
  ChainMetadata,
  ChainRequestRender,
  ChainsMap,
} from "../helpers";

export const XmrChainData: ChainsMap = {
  "mainnet": {
    name: "XMR Mainnet",
    id: "xmr:mainnet",
    rpc: ["https://rpc.cosmos.network"],
    slip44: 145,
    testnet: false,
  },
  "testnet": {
    name: "XMR Testnet",
    id: "xmr:testnet",
    rpc: ["https://rpc.irisnet.org"],
    slip44: 145,
    testnet: true,
  },
};

export const XmrMetadata: NamespaceMetadata = {
  "mainnet": {
    logo: "https://monujo.cash/images/xmr-icon.png",
    rgb: "224, 111, 55",
  },
  "testnet": {
    logo: "https://monujo.cash/images/xmr-icon.png",
    rgb: "224, 111, 55",
  },
};

export function getChainMetadata(chainId: string): ChainMetadata {
  const reference = chainId.split(":")[1];
  const metadata = XmrMetadata[reference];
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
