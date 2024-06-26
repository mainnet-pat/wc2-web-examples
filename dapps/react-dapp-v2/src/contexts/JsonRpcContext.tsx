import { BigNumber, utils } from "ethers";
import { createContext, ReactNode, useContext, useState } from "react";
import * as encoding from "@walletconnect/encoding";
import { Transaction as EthTransaction } from "@ethereumjs/tx";
import { recoverTransaction } from "@celo/wallet-base";
import {
  formatDirectSignDoc,
  stringifySignDocValues,
  verifyAminoSignature,
  verifyDirectSignature,
} from "cosmos-wallet";
import bs58 from "bs58";
import { verifyMessageSignature } from "solana-wallet";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  SystemProgram,
  Transaction as SolanaTransaction,
} from "@solana/web3.js";
// @ts-expect-error
import TronWeb from "tronweb";
import {
  eip712,
  formatTestTransaction,
  getLocalStorageTestnetFlag,
  hashPersonalMessage,
  hashTypedDataMessage,
  parseExtendedJson,
  stringifyExtendedJson,
  verifySignature,
} from "../helpers";
import { useWalletConnectClient } from "./ClientContext";
import {
  DEFAULT_COSMOS_METHODS,
  DEFAULT_EIP155_METHODS,
  DEFAULT_SOLANA_METHODS,
  DEFAULT_POLKADOT_METHODS,
  DEFAULT_NEAR_METHODS,
  DEFAULT_ELROND_METHODS,
  DEFAULT_TRON_METHODS,
  DEFAULT_TEZOS_METHODS,
  DEFAULT_BCH_METHODS,
  DEFAULT_XMR_METHODS,
} from "../constants";
import { useChainData } from "./ChainDataContext";
import { rpcProvidersByChainId } from "../../src/helpers/api";
import { signatureVerify, cryptoWaitReady } from "@polkadot/util-crypto";

import {
  Transaction as ElrondTransaction,
  TransactionPayload,
  Address,
  SignableMessage,
  ISignature,
} from "@elrondnetwork/erdjs";

import { UserVerifier } from "@elrondnetwork/erdjs-walletcore/out/userVerifier";
import { Signature } from "@elrondnetwork/erdjs-walletcore/out/signature";
import { IVerifiable } from "@elrondnetwork/erdjs-walletcore/out/interface";

/**
 * Types
 */
interface IFormattedRpcResponse {
  method?: string;
  address?: string;
  valid: boolean;
  result: string;
}

type TRpcRequestCallback = (chainId: string, address: string) => Promise<void>;

interface IContext {
  ping: () => Promise<void>;
  ethereumRpc: {
    testSendTransaction: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
    testEthSign: TRpcRequestCallback;
    testSignPersonalMessage: TRpcRequestCallback;
    testSignTypedData: TRpcRequestCallback;
  };
  cosmosRpc: {
    testSignDirect: TRpcRequestCallback;
    testSignAmino: TRpcRequestCallback;
  };
  solanaRpc: {
    testSignMessage: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
  };
  polkadotRpc: {
    testSignMessage: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
  };
  nearRpc: {
    testSignAndSendTransaction: TRpcRequestCallback;
    testSignAndSendTransactions: TRpcRequestCallback;
  };
  elrondRpc: {
    testSignMessage: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
    testSignTransactions: TRpcRequestCallback;
  };
  tronRpc: {
    testSignMessage: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
  };
  tezosRpc: {
    testGetAccounts: TRpcRequestCallback;
    testSignMessage: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
  };
  bchRpc: {
    testGetAddresses: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
    testSignMessage: TRpcRequestCallback;
  };
  xmrRpc: {
    testGetAddresses: TRpcRequestCallback;
    testSignTransaction: TRpcRequestCallback;
    testSignMessage: TRpcRequestCallback;
    testGetBalance: TRpcRequestCallback;
    testGetUnlockedBalance: TRpcRequestCallback;
    testGetBalances: TRpcRequestCallback;
  };
  rpcResult?: IFormattedRpcResponse | null;
  isRpcRequestPending: boolean;
  isTestnet: boolean;
  setIsTestnet: (isTestnet: boolean) => void;
}

/**
 * Context
 */
export const JsonRpcContext = createContext<IContext>({} as IContext);

/**
 * Provider
 */
export function JsonRpcContextProvider({
  children,
}: {
  children: ReactNode | ReactNode[];
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<IFormattedRpcResponse | null>();
  const [isTestnet, setIsTestnet] = useState(getLocalStorageTestnetFlag());

  const { client, session, accounts, balances, solanaPublicKeys } =
    useWalletConnectClient();

  const { chainData } = useChainData();

  const _createJsonRpcRequestHandler =
    (
      rpcRequest: (
        chainId: string,
        address: string
      ) => Promise<IFormattedRpcResponse>
    ) =>
    async (chainId: string, address: string) => {
      if (typeof client === "undefined") {
        throw new Error("WalletConnect is not initialized");
      }
      if (typeof session === "undefined") {
        throw new Error("Session is not connected");
      }

      try {
        setPending(true);
        const result = await rpcRequest(chainId, address);
        setResult(result);
      } catch (err: any) {
        console.error("RPC request failed: ", err);
        setResult({
          address,
          valid: false,
          result: err?.message ?? err,
        });
      } finally {
        setPending(false);
      }
    };

  const _verifyEip155MessageSignature = (
    message: string,
    signature: string,
    address: string
  ) =>
    utils.verifyMessage(message, signature).toLowerCase() ===
    address.toLowerCase();

  const ping = async () => {
    if (typeof client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }
    if (typeof session === "undefined") {
      throw new Error("Session is not connected");
    }

    try {
      setPending(true);

      let valid = false;

      try {
        await client.ping({ topic: session.topic });
        valid = true;
      } catch (e) {
        valid = false;
      }

      // display result
      setResult({
        method: "ping",
        valid,
        result: valid ? "Ping succeeded" : "Ping failed",
      });
    } catch (e) {
      console.error(e);
      setResult(null);
    } finally {
      setPending(false);
    }
  };

  // -------- ETHEREUM/EIP155 RPC METHODS --------

  const ethereumRpc = {
    testSendTransaction: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        const caipAccountAddress = `${chainId}:${address}`;
        const account = accounts.find(
          (account) => account === caipAccountAddress
        );
        if (account === undefined)
          throw new Error(`Account for ${caipAccountAddress} not found`);

        const tx = await formatTestTransaction(account);

        const balance = BigNumber.from(balances[account][0].balance || "0");
        if (balance.lt(BigNumber.from(tx.gasPrice).mul(tx.gasLimit))) {
          return {
            method: DEFAULT_EIP155_METHODS.ETH_SEND_TRANSACTION,
            address,
            valid: false,
            result: "Insufficient funds for intrinsic transaction cost",
          };
        }

        const result = await client!.request<string>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_EIP155_METHODS.ETH_SEND_TRANSACTION,
            params: [tx],
          },
        });

        // format displayed result
        return {
          method: DEFAULT_EIP155_METHODS.ETH_SEND_TRANSACTION,
          address,
          valid: true,
          result,
        };
      }
    ),
    testSignTransaction: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        const caipAccountAddress = `${chainId}:${address}`;
        const account = accounts.find(
          (account) => account === caipAccountAddress
        );
        if (account === undefined)
          throw new Error(`Account for ${caipAccountAddress} not found`);

        const tx = await formatTestTransaction(account);

        const signedTx = await client!.request<string>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_EIP155_METHODS.ETH_SIGN_TRANSACTION,
            params: [tx],
          },
        });

        const CELO_ALFAJORES_CHAIN_ID = 44787;
        const CELO_MAINNET_CHAIN_ID = 42220;

        let valid = false;
        const [, reference] = chainId.split(":");
        if (
          reference === CELO_ALFAJORES_CHAIN_ID.toString() ||
          reference === CELO_MAINNET_CHAIN_ID.toString()
        ) {
          const [, signer] = recoverTransaction(signedTx);
          valid = signer.toLowerCase() === address.toLowerCase();
        } else {
          valid = EthTransaction.fromSerializedTx(
            signedTx as any
          ).verifySignature();
        }

        return {
          method: DEFAULT_EIP155_METHODS.ETH_SIGN_TRANSACTION,
          address,
          valid,
          result: signedTx,
        };
      }
    ),
    testSignPersonalMessage: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        // test message
        const message = `My email is john@doe.com - ${Date.now()}`;

        // encode message (hex)
        const hexMsg = encoding.utf8ToHex(message, true);
        // personal_sign params
        const params = [hexMsg, address];

        // send message
        const signature = await client!.request<string>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_EIP155_METHODS.PERSONAL_SIGN,
            params,
          },
        });

        //  split chainId
        const [namespace, reference] = chainId.split(":");
        const rpc = rpcProvidersByChainId[Number(reference)];

        if (typeof rpc === "undefined") {
          throw new Error(
            `Missing rpcProvider definition for chainId: ${chainId}`
          );
        }

        const hashMsg = hashPersonalMessage(message);
        const valid = await verifySignature(
          address,
          signature,
          hashMsg,
          rpc.baseURL
        );

        // format displayed result
        return {
          method: DEFAULT_EIP155_METHODS.PERSONAL_SIGN,
          address,
          valid,
          result: signature,
        };
      }
    ),
    testEthSign: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        // test message
        const message = `My email is john@doe.com - ${Date.now()}`;
        // encode message (hex)
        const hexMsg = encoding.utf8ToHex(message, true);
        // eth_sign params
        const params = [address, hexMsg];

        // send message
        const signature = await client!.request<string>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_EIP155_METHODS.ETH_SIGN,
            params,
          },
        });

        //  split chainId
        const [namespace, reference] = chainId.split(":");
        const rpc = rpcProvidersByChainId[Number(reference)];

        if (typeof rpc === "undefined") {
          throw new Error(
            `Missing rpcProvider definition for chainId: ${chainId}`
          );
        }

        const hashMsg = hashPersonalMessage(message);
        const valid = await verifySignature(
          address,
          signature,
          hashMsg,
          rpc.baseURL
        );

        // format displayed result
        return {
          method: DEFAULT_EIP155_METHODS.ETH_SIGN + " (standard)",
          address,
          valid,
          result: signature,
        };
      }
    ),
    testSignTypedData: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        const message = JSON.stringify(eip712.example);

        // eth_signTypedData params
        const params = [address, message];

        // send message
        const signature = await client!.request<string>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_EIP155_METHODS.ETH_SIGN_TYPED_DATA,
            params,
          },
        });

        //  split chainId
        const [namespace, reference] = chainId.split(":");
        const rpc = rpcProvidersByChainId[Number(reference)];

        if (typeof rpc === "undefined") {
          throw new Error(
            `Missing rpcProvider definition for chainId: ${chainId}`
          );
        }

        const hashedTypedData = hashTypedDataMessage(message);
        const valid = await verifySignature(
          address,
          signature,
          hashedTypedData,
          rpc.baseURL
        );

        return {
          method: DEFAULT_EIP155_METHODS.ETH_SIGN_TYPED_DATA,
          address,
          valid,
          result: signature,
        };
      }
    ),
  };

  // -------- COSMOS RPC METHODS --------

  const cosmosRpc = {
    testSignDirect: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        // test direct sign doc inputs
        const inputs = {
          fee: [{ amount: "2000", denom: "ucosm" }],
          pubkey: "AgSEjOuOr991QlHCORRmdE5ahVKeyBrmtgoYepCpQGOW",
          gasLimit: 200000,
          accountNumber: 1,
          sequence: 1,
          bodyBytes:
            "0a90010a1c2f636f736d6f732e62616e6b2e763162657461312e4d736753656e6412700a2d636f736d6f7331706b707472653766646b6c366766727a6c65736a6a766878686c63337234676d6d6b38727336122d636f736d6f7331717970717870713971637273737a673270767871367273307a716733797963356c7a763778751a100a0575636f736d120731323334353637",
          authInfoBytes:
            "0a500a460a1f2f636f736d6f732e63727970746f2e736563703235366b312e5075624b657912230a21034f04181eeba35391b858633a765c4a0c189697b40d216354d50890d350c7029012040a020801180112130a0d0a0575636f736d12043230303010c09a0c",
        };

        // split chainId
        const [namespace, reference] = chainId.split(":");

        // format sign doc
        const signDoc = formatDirectSignDoc(
          inputs.fee,
          inputs.pubkey,
          inputs.gasLimit,
          inputs.accountNumber,
          inputs.sequence,
          inputs.bodyBytes,
          reference
        );

        // cosmos_signDirect params
        const params = {
          signerAddress: address,
          signDoc: stringifySignDocValues(signDoc),
        };

        // send message
        const result = await client!.request<{ signature: string }>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_COSMOS_METHODS.COSMOS_SIGN_DIRECT,
            params,
          },
        });

        const targetChainData = chainData[namespace][reference];

        if (typeof targetChainData === "undefined") {
          throw new Error(`Missing chain data for chainId: ${chainId}`);
        }

        const valid = await verifyDirectSignature(
          address,
          result.signature,
          signDoc
        );

        // format displayed result
        return {
          method: DEFAULT_COSMOS_METHODS.COSMOS_SIGN_DIRECT,
          address,
          valid,
          result: result.signature,
        };
      }
    ),
    testSignAmino: _createJsonRpcRequestHandler(
      async (chainId: string, address: string) => {
        // split chainId
        const [namespace, reference] = chainId.split(":");

        // test amino sign doc
        const signDoc = {
          msgs: [],
          fee: { amount: [], gas: "23" },
          chain_id: "foochain",
          memo: "hello, world",
          account_number: "7",
          sequence: "54",
        };

        // cosmos_signAmino params
        const params = { signerAddress: address, signDoc };

        // send message
        const result = await client!.request<{ signature: string }>({
          topic: session!.topic,
          chainId,
          request: {
            method: DEFAULT_COSMOS_METHODS.COSMOS_SIGN_AMINO,
            params,
          },
        });

        const targetChainData = chainData[namespace][reference];

        if (typeof targetChainData === "undefined") {
          throw new Error(`Missing chain data for chainId: ${chainId}`);
        }

        const valid = await verifyAminoSignature(
          address,
          result.signature,
          signDoc
        );

        // format displayed result
        return {
          method: DEFAULT_COSMOS_METHODS.COSMOS_SIGN_AMINO,
          address,
          valid,
          result: result.signature,
        };
      }
    ),
  };

  // -------- SOLANA RPC METHODS --------

  const solanaRpc = {
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        if (!solanaPublicKeys) {
          throw new Error("Could not find Solana PublicKeys.");
        }

        const senderPublicKey = solanaPublicKeys[address];

        const connection = new Connection(
          clusterApiUrl(isTestnet ? "testnet" : "mainnet-beta")
        );

        // Using deprecated `getRecentBlockhash` over `getLatestBlockhash` here, since `mainnet-beta`
        // cluster only seems to support `connection.getRecentBlockhash` currently.
        const { blockhash } = await connection.getRecentBlockhash();

        const transaction = new SolanaTransaction({
          feePayer: senderPublicKey,
          recentBlockhash: blockhash,
        }).add(
          SystemProgram.transfer({
            fromPubkey: senderPublicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
          })
        );

        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_SOLANA_METHODS.SOL_SIGN_TRANSACTION,
              params: {
                feePayer: transaction.feePayer!.toBase58(),
                recentBlockhash: transaction.recentBlockhash,
                instructions: transaction.instructions.map((i) => ({
                  programId: i.programId.toBase58(),
                  data: Array.from(i.data),
                  keys: i.keys.map((k) => ({
                    isSigner: k.isSigner,
                    isWritable: k.isWritable,
                    pubkey: k.pubkey.toBase58(),
                  })),
                })),
              },
            },
          });

          // We only need `Buffer.from` here to satisfy the `Buffer` param type for `addSignature`.
          // The resulting `UInt8Array` is equivalent to just `bs58.decode(...)`.
          transaction.addSignature(
            senderPublicKey,
            Buffer.from(bs58.decode(result.signature))
          );

          const valid = transaction.verifySignatures();

          return {
            method: DEFAULT_SOLANA_METHODS.SOL_SIGN_TRANSACTION,
            address,
            valid,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        if (!solanaPublicKeys) {
          throw new Error("Could not find Solana PublicKeys.");
        }

        const senderPublicKey = solanaPublicKeys[address];

        // Encode message to `UInt8Array` first via `TextEncoder` so we can pass it to `bs58.encode`.
        const message = bs58.encode(
          new TextEncoder().encode(
            `This is an example message to be signed - ${Date.now()}`
          )
        );

        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_SOLANA_METHODS.SOL_SIGN_MESSAGE,
              params: {
                pubkey: senderPublicKey.toBase58(),
                message,
              },
            },
          });

          const valid = verifyMessageSignature(
            senderPublicKey.toBase58(),
            result.signature,
            message
          );

          return {
            method: DEFAULT_SOLANA_METHODS.SOL_SIGN_MESSAGE,
            address,
            valid,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
  };

  // -------- POLKADOT RPC METHODS --------
  const polkadotRpc = {
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const transactionPayload = {
          specVersion: "0x00002468",
          transactionVersion: "0x0000000e",
          address: `${address}`,
          blockHash:
            "0x554d682a74099d05e8b7852d19c93b527b5fae1e9e1969f6e1b82a2f09a14cc9",
          blockNumber: "0x00cb539c",
          era: "0xc501",
          genesisHash:
            "0xe143f23803ac50e8f6f8e62695d1ce9e4e1d68aa36c1cd2cfd15340213f3423e",
          method:
            "0x0001784920616d207369676e696e672074686973207472616e73616374696f6e21",
          nonce: "0x00000000",
          signedExtensions: [
            "CheckNonZeroSender",
            "CheckSpecVersion",
            "CheckTxVersion",
            "CheckGenesis",
            "CheckMortality",
            "CheckNonce",
            "CheckWeight",
            "ChargeTransactionPayment",
          ],
          tip: "0x00000000000000000000000000000000",
          version: 4,
        };

        try {
          const result = await client!.request<{
            payload: string;
            signature: string;
          }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_POLKADOT_METHODS.POLKADOT_SIGN_TRANSACTION,
              params: {
                address,
                transactionPayload,
              },
            },
          });

          return {
            method: DEFAULT_POLKADOT_METHODS.POLKADOT_SIGN_TRANSACTION,
            address,
            valid: true,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const message = `This is an example message to be signed - ${Date.now()}`;

        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_POLKADOT_METHODS.POLKADOT_SIGN_MESSAGE,
              params: {
                address,
                message,
              },
            },
          });

          // sr25519 signatures need to wait for WASM to load
          await cryptoWaitReady();
          const { isValid: valid } = signatureVerify(
            message,
            result.signature,
            address
          );

          return {
            method: DEFAULT_POLKADOT_METHODS.POLKADOT_SIGN_MESSAGE,
            address,
            valid,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
  };

  // -------- NEAR RPC METHODS --------

  const nearRpc = {
    testSignAndSendTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const method = DEFAULT_NEAR_METHODS.NEAR_SIGN_AND_SEND_TRANSACTION;
        const result = await client!.request({
          topic: session!.topic,
          chainId,
          request: {
            method,
            params: {
              transaction: {
                signerId: address,
                receiverId: "guest-book.testnet",
                actions: [
                  {
                    type: "FunctionCall",
                    params: {
                      methodName: "addMessage",
                      args: { text: "Hello from Wallet Connect!" },
                      gas: "30000000000000",
                      deposit: "0",
                    },
                  },
                ],
              },
            },
          },
        });

        return {
          method,
          address,
          valid: true,
          result: JSON.stringify((result as any).transaction),
        };
      }
    ),
    testSignAndSendTransactions: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const method = DEFAULT_NEAR_METHODS.NEAR_SIGN_AND_SEND_TRANSACTIONS;
        const result = await client!.request({
          topic: session!.topic,
          chainId,
          request: {
            method,
            params: {
              transactions: [
                {
                  signerId: address,
                  receiverId: "guest-book.testnet",
                  actions: [
                    {
                      type: "FunctionCall",
                      params: {
                        methodName: "addMessage",
                        args: { text: "Hello from Wallet Connect! (1/2)" },
                        gas: "30000000000000",
                        deposit: "0",
                      },
                    },
                  ],
                },
                {
                  signerId: address,
                  receiverId: "guest-book.testnet",
                  actions: [
                    {
                      type: "FunctionCall",
                      params: {
                        methodName: "addMessage",
                        args: { text: "Hello from Wallet Connect! (2/2)" },
                        gas: "30000000000000",
                        deposit: "0",
                      },
                    },
                  ],
                },
              ],
            },
          },
        });

        return {
          method,
          address,
          valid: true,
          result: JSON.stringify(
            (result as any).map((r: any) => r.transaction)
          ),
        };
      }
    ),
  };

  // -------- ELROND RPC METHODS --------

  const elrondRpc = {
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const reference = chainId.split(":")[1];

        const userAddress = new Address(address);
        const verifier = UserVerifier.fromAddress(userAddress);
        const transactionPayload = new TransactionPayload("testdata");

        const testTransaction = new ElrondTransaction({
          nonce: 1,
          value: "10000000000000000000",
          receiver: Address.fromBech32(address),
          sender: userAddress,
          gasPrice: 1000000000,
          gasLimit: 50000,
          chainID: reference,
          data: transactionPayload,
        });
        const transaction = testTransaction.toPlainObject();

        try {
          const result = await client!.request<{ signature: Buffer }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_ELROND_METHODS.ELROND_SIGN_TRANSACTION,
              params: {
                transaction,
              },
            },
          });

          testTransaction.applySignature(
            new Signature(result.signature),
            userAddress
          );

          const valid = verifier.verify(testTransaction as IVerifiable);

          return {
            method: DEFAULT_ELROND_METHODS.ELROND_SIGN_TRANSACTION,
            address,
            valid,
            result: result.signature.toString(),
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
    testSignTransactions: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const reference = chainId.split(":")[1];

        const userAddress = new Address(address);
        const verifier = UserVerifier.fromAddress(userAddress);
        const testTransactionPayload = new TransactionPayload("testdata");

        const testTransaction = new ElrondTransaction({
          nonce: 1,
          value: "10000000000000000000",
          receiver: Address.fromBech32(address),
          sender: userAddress,
          gasPrice: 1000000000,
          gasLimit: 50000,
          chainID: reference,
          data: testTransactionPayload,
        });

        // no data for this Transaction
        const testTransaction2 = new ElrondTransaction({
          nonce: 2,
          value: "20000000000000000000",
          receiver: Address.fromBech32(address),
          sender: userAddress,
          gasPrice: 1000000000,
          gasLimit: 50000,
          chainID: reference,
        });

        const testTransaction3Payload = new TransactionPayload("third");
        const testTransaction3 = new ElrondTransaction({
          nonce: 3,
          value: "300000000000000000",
          receiver: Address.fromBech32(address),
          sender: userAddress,
          gasPrice: 1000000000,
          gasLimit: 50000,
          chainID: reference,
          data: testTransaction3Payload,
        });

        const transactions = [
          testTransaction,
          testTransaction2,
          testTransaction3,
        ].map((transaction) => transaction.toPlainObject());

        try {
          const result = await client!.request<{
            signatures: { signature: Buffer }[];
          }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_ELROND_METHODS.ELROND_SIGN_TRANSACTIONS,
              params: {
                transactions,
              },
            },
          });

          const valid = [
            testTransaction,
            testTransaction2,
            testTransaction3,
          ].reduce((acc, current, index) => {
            current.applySignature(
              new Signature(result.signatures[index].signature),
              userAddress
            );

            return acc && verifier.verify(current as IVerifiable);
          }, true);

          const resultSignatures = result.signatures.map(
            (signature: any) => signature.signature
          );

          return {
            method: DEFAULT_ELROND_METHODS.ELROND_SIGN_TRANSACTIONS,
            address,
            valid,
            result: resultSignatures.join(", "),
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const userAddress = new Address(address);
        const verifier = UserVerifier.fromAddress(userAddress);

        const testMessage = new SignableMessage({
          address: userAddress,
          message: Buffer.from(`Sign this message - ${Date.now()}`, "ascii"),
        });

        try {
          const result = await client!.request<{ signature: Buffer }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_ELROND_METHODS.ELROND_SIGN_MESSAGE,
              params: {
                address,
                message: testMessage.message.toString(),
              },
            },
          });

          testMessage.applySignature(new Signature(result.signature));

          const valid = verifier.verify(testMessage);

          return {
            method: DEFAULT_ELROND_METHODS.ELROND_SIGN_MESSAGE,
            address,
            valid,
            result: result.signature.toString(),
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
  };

  // -------- TRON RPC METHODS --------

  const tronRpc = {
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        // Nile TestNet, if you want to use in MainNet, change the fullHost to 'https://api.trongrid.io'
        const fullHost = isTestnet
          ? "https://nile.trongrid.io/"
          : "https://api.trongrid.io/";

        const tronWeb = new TronWeb({
          fullHost,
        });

        // Take USDT as an example:
        // Nile TestNet: https://nile.tronscan.org/#/token20/TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
        // MainNet: https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

        const testContract = isTestnet
          ? "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
          : "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        const testTransaction =
          await tronWeb.transactionBuilder.triggerSmartContract(
            testContract,
            "approve(address,uint256)",
            { feeLimit: 200000000 },
            [
              { type: "address", value: address },
              { type: "uint256", value: 0 },
            ],
            address
          );

        try {
          const { result } = await client!.request<{ result: any }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_TRON_METHODS.TRON_SIGN_TRANSACTION,
              params: {
                address,
                transaction: {
                  ...testTransaction,
                },
              },
            },
          });

          return {
            method: DEFAULT_TRON_METHODS.TRON_SIGN_TRANSACTION,
            address,
            valid: true,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const message = "This is a message to be signed for Tron";

        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_TRON_METHODS.TRON_SIGN_MESSAGE,
              params: {
                address,
                message,
              },
            },
          });

          return {
            method: DEFAULT_TRON_METHODS.TRON_SIGN_MESSAGE,
            address,
            valid: true,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error);
        }
      }
    ),
  };

  // -------- TEZOS RPC METHODS --------

  const tezosRpc = {
    testGetAccounts: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_TEZOS_METHODS.TEZOS_GET_ACCOUNTS,
              params: {},
            },
          });

          return {
            method: DEFAULT_TEZOS_METHODS.TEZOS_GET_ACCOUNTS,
            address,
            valid: true,
            result: JSON.stringify(result, null, 2),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = await client!.request<{ hash: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_TEZOS_METHODS.TEZOS_SEND,
              params: {
                account: address,
                operations: [
                  {
                    kind: "transaction",
                    amount: "1", // 1 mutez, smallest unit
                    destination: address, // send to ourselves
                  },
                ],
              },
            },
          });

          return {
            method: DEFAULT_TEZOS_METHODS.TEZOS_SEND,
            address,
            valid: true,
            result: result.hash,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const payload = "05010000004254";

        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_TEZOS_METHODS.TEZOS_SIGN,
              params: {
                account: address,
                payload,
              },
            },
          });

          return {
            method: DEFAULT_TEZOS_METHODS.TEZOS_SIGN,
            address,
            valid: true,
            result: result.signature,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
  };

  // -------- BCH RPC METHODS --------

  const bchRpc = {
    testGetAddresses: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = await client!.request<{ signature: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_BCH_METHODS.BCH_GET_ADDRESSES,
              params: {},
            },
          });

          return {
            method: DEFAULT_BCH_METHODS.BCH_GET_ADDRESSES,
            address,
            valid: true,
            result: JSON.stringify(result, null, 2),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = await client!.request<{ hash: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_BCH_METHODS.BCH_SIGN_TRANSACTION,
              params: {
                "transaction": {
                  "inputs": [
                    {
                      "outpointIndex": 0,
                      "outpointTransactionHash": "<Uint8Array: 0xe9aa3a136fb47adf826f78220b1bcc41e0920ee87dd9394513519192137046db>",
                      "sequenceNumber": 4294967294,
                      "unlockingBytecode": "<Uint8Array: 0x004ce85414c3a3bdec377fd2757fa25596150ea78defc14f4d540390d0035479009c6300ce827701219d5379547a9dc3529d00cd00c78800d100ce8800cc00c65279939d00cf527f7781768b537aa16900d202feed52798b52807e8800d3009d02e80351cc789d51cd51c78851d3009d51d101207f7500ce01207f758851d27b52808802200351c6537a947c947c94760222029f63c4529d6751c752cd788852cc52799dc4539d52d181009d75686d755167547a519d5479a953798871adc3519d00ce8277009e6300cd00c78800d100ce8800cc02e8039d51cd0376a91454797e0288ac7e88686d6d5168>"
                    },
                    {
                      "outpointIndex": 2,
                      "outpointTransactionHash": "<Uint8Array: 0xe9aa3a136fb47adf826f78220b1bcc41e0920ee87dd9394513519192137046db>",
                      "sequenceNumber": 4294967294,
                      "unlockingBytecode": "<Uint8Array: 0x>"
                    }
                  ],
                  "locktime": 153432,
                  "outputs": [
                    {
                      "lockingBytecode": "<Uint8Array: 0xa91469ba5a522337e2d59cc1a36bc25b1b4a2753075b87>",
                      "token": {
                        "amount": "<bigint: 0n>",
                        "category": "<Uint8Array: 0x9ec9f55af7ac914da2b272809abbbf51a848648c4555d144529cf150c58e2682>",
                        "nft": {
                          "capability": "minting",
                          "commitment": "<Uint8Array: 0xfeed0200>"
                        }
                      },
                      "valueSatoshis": "<bigint: 501000n>"
                    },
                    {
                      "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
                      "token": {
                        "amount": "<bigint: 0n>",
                        "category": "<Uint8Array: 0x9ec9f55af7ac914da2b272809abbbf51a848648c4555d144529cf150c58e2682>",
                        "nft": {
                          "capability": "none",
                          "commitment": "<Uint8Array: 0x0100>"
                        }
                      },
                      "valueSatoshis": "<bigint: 1000n>"
                    },
                    {
                      "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
                      "valueSatoshis": "<bigint: 9601207n>"
                    }
                  ],
                  "version": 2
                },
                "sourceOutputs": [
                  {
                    "outpointIndex": 0,
                    "outpointTransactionHash": "<Uint8Array: 0xe9aa3a136fb47adf826f78220b1bcc41e0920ee87dd9394513519192137046db>",
                    "sequenceNumber": 4294967294,
                    "unlockingBytecode": "<Uint8Array: 0x004ce85414c3a3bdec377fd2757fa25596150ea78defc14f4d540390d0035479009c6300ce827701219d5379547a9dc3529d00cd00c78800d100ce8800cc00c65279939d00cf527f7781768b537aa16900d202feed52798b52807e8800d3009d02e80351cc789d51cd51c78851d3009d51d101207f7500ce01207f758851d27b52808802200351c6537a947c947c94760222029f63c4529d6751c752cd788852cc52799dc4539d52d181009d75686d755167547a519d5479a953798871adc3519d00ce8277009e6300cd00c78800d100ce8800cc02e8039d51cd0376a91454797e0288ac7e88686d6d5168>",
                    "lockingBytecode": "<Uint8Array: 0xa91469ba5a522337e2d59cc1a36bc25b1b4a2753075b87>",
                    "valueSatoshis": "<bigint: 251000n>",
                    "token": {
                      "category": "<Uint8Array: 0x9ec9f55af7ac914da2b272809abbbf51a848648c4555d144529cf150c58e2682>",
                      "nft": {
                        "capability": "minting",
                        "commitment": "<Uint8Array: 0xfeed0100>"
                      }
                    },
                    "contract": {
                      "abiFunction": {
                        "name": "mint",
                        "inputs": []
                      },
                      "redeemScript": "<Uint8Array: 0x5414c3a3bdec377fd2757fa25596150ea78defc14f4d540390d0035479009c6300ce827701219d5379547a9dc3529d00cd00c78800d100ce8800cc00c65279939d00cf527f7781768b537aa16900d202feed52798b52807e8800d3009d02e80351cc789d51cd51c78851d3009d51d101207f7500ce01207f758851d27b52808802200351c6537a947c947c94760222029f63c4529d6751c752cd788852cc52799dc4539d52d181009d75686d755167547a519d5479a953798871adc3519d00ce8277009e6300cd00c78800d100ce8800cc02e8039d51cd0376a91454797e0288ac7e88686d6d5168>",
                      "artifact": {
                        "contractName": "MintingCovenant",
                        "constructorInputs": [
                          {
                            "name": "mintCost",
                            "type": "int"
                          },
                          {
                            "name": "maxAmount",
                            "type": "int"
                          },
                          {
                            "name": "owner",
                            "type": "bytes20"
                          },
                          {
                            "name": "nonce",
                            "type": "int"
                          }
                        ],
                        "abi": [
                          {
                            "name": "mint",
                            "inputs": []
                          },
                          {
                            "name": "withdraw",
                            "inputs": [
                              {
                                "name": "pk",
                                "type": "pubkey"
                              },
                              {
                                "name": "s",
                                "type": "sig"
                              }
                            ]
                          }
                        ],
                        "compiler": {
                          "name": "cashc",
                          "version": "0.8.0-next.2"
                        },
                        "updatedAt": "2023-06-25T06:53:19.192Z"
                      }
                    }
                  },
                  {
                    "outpointIndex": 2,
                    "outpointTransactionHash": "<Uint8Array: 0xe9aa3a136fb47adf826f78220b1bcc41e0920ee87dd9394513519192137046db>",
                    "sequenceNumber": 4294967294,
                    "unlockingBytecode": "<Uint8Array: 0x>",
                    "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
                    "valueSatoshis": "<bigint: 9853007n>"
                  }
                ],
                "broadcast": false,
                "userPrompt": "Mint new NFT"
              },
            },
          });

          return {
            method: DEFAULT_BCH_METHODS.BCH_SIGN_TRANSACTION,
            address,
            valid: true,
            result: result.hash,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const payload = "05010000004254";

        try {
          const result = await client!.request<string>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_BCH_METHODS.BCH_SIGN_MESSAGE,
              params: {
                address: address,
                message: payload,
              },
            },
          });
          console.log(11, result)

          return {
            method: DEFAULT_BCH_METHODS.BCH_SIGN_MESSAGE,
            address,
            valid: true,
            result: result,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    
  };

  // -------- XMR RPC METHODS --------

  const xmrRpc = {
    testGetAddresses: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = await client!.request<string[]>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_GET_ADDRESSES,
              params: {},
            },
          });

          return {
            method: DEFAULT_XMR_METHODS.XMR_GET_ADDRESSES,
            address,
            valid: true,
            result: JSON.stringify(result, null, 2),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    testSignTransaction: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const address1 = chainId === "xmr:mainnet" ? "489BrGYiEjiMpgAFhoe5hZZTgKKtdPe3xeV1xYyrR8rJLKNwGfSxzJoBSDj4MUs8nVMBybiPhbfU4cRTm8pd2u696XHxV62" : "9xGZuCEjC4B2KGVrterGuKK6iskFP3RarWsjSNrY7F49dPq26gDJr2DgavcpqRxWh9UFUds64Lie5DfxR5BFwVVKDMCaTjW";
          const address2 = chainId === "xmr:mainnet" ? "46FR1GKVqFNQnDiFkH7AuzbUBrGQwz2VdaXTDD4jcjRE8YkkoTYTmZ2Vohsz9gLSqkj5EM6ai9Q7sBoX4FPPYJdGKQQXPVz" : "9waNBpGwmoqBon2t1vAMFX3GPu2BHNSzPeGjFowLeadaidLLWKW3NUYGs8KXRMZuLQMeMTtufVxWiJvnQUAr1KAtPGAojsj";
          const result = await client!.request<{ hash: string }>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_SIGN_TRANSACTION,
              params: JSON.parse(stringifyExtendedJson({
                transaction: {
                  destinations: [
                    {
                      address: address1,
                      amount: BigInt(1e12),
                    },
                    {
                      address: address2,
                      amount: BigInt(1e12),
                    },
                  ],
                  accountIndex: 0,
                  relay: false,
                },
                userPrompt: "Sign this transaction",
                broadcast: false,
              })),
            },
          });

          return {
            method: DEFAULT_XMR_METHODS.XMR_SIGN_TRANSACTION,
            address,
            valid: true,
            result: result.hash,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    
    testSignMessage: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        const payload = "05010000004254";

        try {
          const result = await client!.request<string>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_SIGN_MESSAGE,
              params: {
                address: address,
                message: payload,
              },
            },
          });
          console.log(11, result)

          return {
            method: DEFAULT_XMR_METHODS.XMR_SIGN_MESSAGE,
            address,
            valid: true,
            result: result,
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
    
    testGetBalance: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = parseExtendedJson(JSON.stringify(await client!.request({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_GET_BALANCE,
              params: {
                address: address,
              },
            },
          })));
          console.log(11, result)

          return {
            method: DEFAULT_XMR_METHODS.XMR_GET_BALANCE,
            address,
            valid: true,
            result: result.toString(),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),

    testGetUnlockedBalance: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = parseExtendedJson(JSON.stringify(await client!.request<bigint>({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_GET_UNLOCKED_BALANCE,
              params: {
                address: address,
              },
            },
          })));

          return {
            method: DEFAULT_XMR_METHODS.XMR_GET_UNLOCKED_BALANCE,
            address,
            valid: true,
            result: result.toString(),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),

    testGetBalances: _createJsonRpcRequestHandler(
      async (
        chainId: string,
        address: string
      ): Promise<IFormattedRpcResponse> => {
        try {
          const result = parseExtendedJson(JSON.stringify(await client!.request({
            chainId,
            topic: session!.topic,
            request: {
              method: DEFAULT_XMR_METHODS.XMR_GET_BALANCES,
              params: {
                address: address,
              },
            },
          })));
          console.log(11, result)

          console.log(result);
          return {
            method: DEFAULT_XMR_METHODS.XMR_GET_BALANCES,
            address,
            valid: true,
            result: stringifyExtendedJson(result, 2),
          };
        } catch (error: any) {
          throw new Error(error.message);
        }
      }
    ),
  };

  return (
    <JsonRpcContext.Provider
      value={{
        ping,
        ethereumRpc,
        cosmosRpc,
        solanaRpc,
        polkadotRpc,
        nearRpc,
        elrondRpc,
        tronRpc,
        tezosRpc,
        bchRpc,
        xmrRpc,
        rpcResult: result,
        isRpcRequestPending: pending,
        isTestnet,
        setIsTestnet,
      }}
    >
      {children}
    </JsonRpcContext.Provider>
  );
}

export function useJsonRpc() {
  const context = useContext(JsonRpcContext);
  if (context === undefined) {
    throw new Error("useJsonRpc must be used within a JsonRpcContextProvider");
  }
  return context;
}
