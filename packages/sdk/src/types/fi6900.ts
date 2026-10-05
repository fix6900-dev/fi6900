/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fi6900.json`.
 */
export type Fi6900 = {
  "address": "Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV",
  "metadata": {
    "name": "fi6900",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "FI6900 on-chain memecoin index fund"
  },
  "instructions": [
    {
      "name": "acceptAuthority",
      "discriminator": [
        107,
        86,
        198,
        91,
        33,
        12,
        107,
        160
      ],
      "accounts": [
        {
          "name": "pendingAuthority",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "accrueManagementFee",
      "discriminator": [
        91,
        57,
        239,
        81,
        27,
        216,
        220,
        148
      ],
      "accounts": [
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "indexMint",
          "writable": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "feeRecipientAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "addAsset",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_ADD_ASSET."
      ],
      "discriminator": [
        81,
        53,
        134,
        142,
        243,
        73,
        42,
        179
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "asset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetWeightBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "beginMint",
      "discriminator": [
        27,
        97,
        108,
        220,
        170,
        118,
        55,
        167
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "indexMint",
          "relations": [
            "fund"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116,
                  95,
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "beginMintContinue",
      "discriminator": [
        17,
        49,
        120,
        58,
        29,
        165,
        22,
        109
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "indexMint",
          "relations": [
            "fund"
          ]
        },
        {
          "name": "session",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "beginRedeem",
      "discriminator": [
        105,
        132,
        194,
        143,
        173,
        148,
        233,
        36
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "indexMint",
          "writable": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  100,
                  101,
                  101,
                  109,
                  95,
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "ownerIndexAta",
          "writable": true
        },
        {
          "name": "feeRecipientAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "beginRedeemContinue",
      "discriminator": [
        159,
        180,
        12,
        227,
        89,
        40,
        251,
        144
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "indexMint",
          "relations": [
            "fund"
          ]
        },
        {
          "name": "session",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "beginRemoveAsset",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_BEGIN_REMOVE_ASSET."
      ],
      "discriminator": [
        242,
        145,
        203,
        100,
        241,
        74,
        15,
        139
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "asset",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "bootstrapMint",
      "discriminator": [
        115,
        110,
        110,
        184,
        153,
        184,
        119,
        112
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "indexMint",
          "writable": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "recipientAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "units",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelAction",
      "docs": [
        "Authority."
      ],
      "discriminator": [
        228,
        144,
        170,
        146,
        66,
        88,
        133,
        128
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true
        },
        {
          "name": "proposer",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelAuction",
      "discriminator": [
        156,
        43,
        197,
        110,
        218,
        105,
        143,
        182
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "auction"
          ]
        },
        {
          "name": "auction",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelMintClose",
      "discriminator": [
        126,
        115,
        209,
        168,
        11,
        194,
        26,
        82
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "session",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelMintRefund",
      "discriminator": [
        83,
        152,
        192,
        159,
        239,
        60,
        196,
        107
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "fund",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "relations": [
            "asset"
          ]
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u16"
        }
      ]
    },
    {
      "name": "closeRedeem",
      "discriminator": [
        7,
        239,
        180,
        87,
        72,
        144,
        243,
        174
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "session",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "`gross_amount` defaults to `required[slot]`; Token-2022 fee mints need a gross whose net",
        "(after the transfer fee) is >= required, otherwise `ShortDeposit`."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "fund",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "relations": [
            "asset"
          ]
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u16"
        },
        {
          "name": "grossAmount",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "executeAction",
      "docs": [
        "Anyone, after eta. Every kind except ADD_ASSET / SET_TOKEN_METADATA (which have their own ixs)."
      ],
      "discriminator": [
        246,
        137,
        105,
        113,
        247,
        6,
        223,
        174
      ],
      "accounts": [
        {
          "name": "executor",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "action",
            "asset"
          ]
        },
        {
          "name": "action",
          "writable": true
        },
        {
          "name": "proposer",
          "writable": true
        },
        {
          "name": "asset",
          "docs": [
            "Required for SET_TARGET_WEIGHT / REF_PRICE_OVERRIDE / BEGIN_REMOVE_ASSET."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "executeActionAddAsset",
      "docs": [
        "Anyone, after eta. ADD_ASSET only (creates the Asset PDA and vault ATA)."
      ],
      "discriminator": [
        155,
        183,
        249,
        179,
        84,
        41,
        242,
        116
      ],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "action"
          ]
        },
        {
          "name": "action",
          "writable": true
        },
        {
          "name": "proposer",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "asset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "fillAuction",
      "docs": [
        "`gross_buy_amount` defaults to the price-implied buy amount; the buy vault must receive at",
        "least that much (`ShortFill` otherwise), so a fee on the buy token is paid by the filler."
      ],
      "discriminator": [
        51,
        225,
        89,
        197,
        65,
        5,
        178,
        250
      ],
      "accounts": [
        {
          "name": "filler",
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "auction",
            "sellAsset",
            "buyAsset"
          ]
        },
        {
          "name": "auction",
          "writable": true
        },
        {
          "name": "sellAsset",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "buyAsset",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "sellVault",
          "writable": true
        },
        {
          "name": "buyVault",
          "writable": true
        },
        {
          "name": "fillerSellToken",
          "docs": [
            "Filler's account that receives the sold tokens."
          ],
          "writable": true
        },
        {
          "name": "fillerBuyToken",
          "docs": [
            "Filler's account that pays the bought tokens (filler must be its authority)."
          ],
          "writable": true
        },
        {
          "name": "sellMint"
        },
        {
          "name": "buyMint"
        },
        {
          "name": "sellTokenProgram"
        },
        {
          "name": "buyTokenProgram"
        }
      ],
      "args": [
        {
          "name": "sellAmount",
          "type": "u64"
        },
        {
          "name": "grossBuyAmount",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "finalizeMint",
      "discriminator": [
        77,
        12,
        218,
        47,
        57,
        4,
        38,
        239
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund"
        },
        {
          "name": "indexMint",
          "writable": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "ownerIndexAta",
          "writable": true
        },
        {
          "name": "feeRecipientAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeRemoveAsset",
      "discriminator": [
        187,
        177,
        31,
        44,
        214,
        190,
        203,
        58
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "asset"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initializeFund",
      "discriminator": [
        212,
        42,
        24,
        245,
        146,
        141,
        78,
        198
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "fund",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "indexMint"
              }
            ]
          }
        },
        {
          "name": "indexMint",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "mintFeeBps",
          "type": "u16"
        },
        {
          "name": "redeemFeeBps",
          "type": "u16"
        },
        {
          "name": "mgmtFeeBps",
          "type": "u16"
        },
        {
          "name": "timelockSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeAuthority",
      "discriminator": [
        20,
        148,
        236,
        198,
        76,
        119,
        99,
        142
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "queueAction",
      "docs": [
        "Authority. Creates PendingAction [\"pending\", fund, action_nonce] with eta = now + timelock."
      ],
      "discriminator": [
        5,
        13,
        174,
        118,
        170,
        185,
        22,
        7
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        },
        {
          "name": "action",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "fund.action_nonce",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "key",
          "type": "pubkey"
        },
        {
          "name": "values",
          "type": {
            "array": [
              "u64",
              4
            ]
          }
        }
      ]
    },
    {
      "name": "setAuctionParams",
      "docs": [
        "Direct (timelock must be 0): max_auction_discount_bps, max_ref_move_bps, ref_move_period_slots."
      ],
      "discriminator": [
        129,
        45,
        195,
        89,
        182,
        202,
        252,
        36
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "maxAuctionDiscountBps",
          "type": "u16"
        },
        {
          "name": "maxRefMoveBps",
          "type": "u16"
        },
        {
          "name": "refMovePeriodSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setFeeRecipient",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_SET_FEE_RECIPIENT."
      ],
      "discriminator": [
        227,
        18,
        215,
        42,
        237,
        246,
        151,
        66
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newFeeRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setFees",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_SET_FEES."
      ],
      "discriminator": [
        137,
        178,
        49,
        58,
        0,
        245,
        242,
        190
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "mintFeeBps",
          "type": "u16"
        },
        {
          "name": "redeemFeeBps",
          "type": "u16"
        },
        {
          "name": "mgmtFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Protective; never timelocked."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "mask",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setRebalancer",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_SET_REBALANCER."
      ],
      "discriminator": [
        28,
        161,
        168,
        250,
        215,
        4,
        144,
        154
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newRebalancer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setRefPrice",
      "docs": [
        "Rebalancer or authority. Q64.64 numeraire per raw base unit."
      ],
      "discriminator": [
        50,
        233,
        193,
        158,
        20,
        64,
        204,
        220
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "fund",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "asset",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u128"
        }
      ]
    },
    {
      "name": "setTargetWeight",
      "docs": [
        "Direct (timelock must be 0). Otherwise queue ACTION_SET_TARGET_WEIGHT."
      ],
      "discriminator": [
        229,
        1,
        38,
        198,
        7,
        171,
        35,
        33
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "asset",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "targetWeightBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setTimelock",
      "docs": [
        "Enables the timelock while it is 0. Changing it afterwards requires ACTION_SET_TIMELOCK."
      ],
      "discriminator": [
        131,
        159,
        222,
        21,
        225,
        226,
        54,
        214
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "timelockSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setTokenMetadata",
      "docs": [
        "Metaplex metadata (name / symbol / uri) for the index mint, created or updated through the",
        "fund PDA (mint + update authority). Direct while the timelock is 0; otherwise pass the due",
        "ACTION_SET_TOKEN_METADATA action (key = token_metadata_hash) and its proposer."
      ],
      "discriminator": [
        218,
        126,
        122,
        193,
        220,
        149,
        103,
        39
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "relations": [
            "action"
          ]
        },
        {
          "name": "indexMint",
          "relations": [
            "fund"
          ]
        },
        {
          "name": "metadata",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "tokenMetadataProgram"
              },
              {
                "kind": "account",
                "path": "indexMint"
              }
            ],
            "program": {
              "kind": "account",
              "path": "tokenMetadataProgram"
            }
          }
        },
        {
          "name": "action",
          "docs": [
            "Required while the timelock is armed: a due ACTION_SET_TOKEN_METADATA whose key is the payload hash."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "proposer",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "startAuction",
      "discriminator": [
        255,
        2,
        149,
        136,
        148,
        125,
        65,
        195
      ],
      "accounts": [
        {
          "name": "rebalancer",
          "writable": true,
          "signer": true,
          "relations": [
            "fund"
          ]
        },
        {
          "name": "fund",
          "writable": true,
          "relations": [
            "sellAsset",
            "buyAsset"
          ]
        },
        {
          "name": "sellAsset"
        },
        {
          "name": "buyAsset"
        },
        {
          "name": "vault",
          "docs": [
            "The sell asset's vault (checked against sell_asset.vault via has_one)."
          ],
          "relations": [
            "sellAsset"
          ]
        },
        {
          "name": "auction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "fund"
              },
              {
                "kind": "account",
                "path": "fund.auction_nonce",
                "account": "fund"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sellAmount",
          "type": "u64"
        },
        {
          "name": "startPrice",
          "type": "u128"
        },
        {
          "name": "endPrice",
          "type": "u128"
        },
        {
          "name": "durationSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "fund",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "asset",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "asset"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "asset"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "relations": [
            "asset"
          ]
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "asset",
      "discriminator": [
        234,
        180,
        241,
        252,
        139,
        224,
        160,
        8
      ]
    },
    {
      "name": "auction",
      "discriminator": [
        218,
        94,
        247,
        242,
        126,
        233,
        131,
        81
      ]
    },
    {
      "name": "fund",
      "discriminator": [
        62,
        128,
        183,
        208,
        91,
        31,
        212,
        209
      ]
    },
    {
      "name": "mintSession",
      "discriminator": [
        73,
        29,
        190,
        80,
        150,
        237,
        19,
        58
      ]
    },
    {
      "name": "pendingAction",
      "discriminator": [
        10,
        76,
        29,
        155,
        104,
        63,
        34,
        51
      ]
    },
    {
      "name": "redeemSession",
      "discriminator": [
        20,
        42,
        70,
        57,
        188,
        226,
        116,
        15
      ]
    }
  ],
  "events": [
    {
      "name": "actionCancelled",
      "discriminator": [
        121,
        213,
        205,
        29,
        226,
        181,
        230,
        13
      ]
    },
    {
      "name": "actionExecuted",
      "discriminator": [
        116,
        101,
        146,
        36,
        160,
        153,
        182,
        233
      ]
    },
    {
      "name": "actionQueued",
      "discriminator": [
        77,
        189,
        39,
        169,
        248,
        125,
        126,
        168
      ]
    },
    {
      "name": "assetAdded",
      "discriminator": [
        174,
        91,
        37,
        97,
        47,
        14,
        45,
        93
      ]
    },
    {
      "name": "assetRemoved",
      "discriminator": [
        100,
        213,
        14,
        53,
        106,
        252,
        170,
        140
      ]
    },
    {
      "name": "auctionClosed",
      "discriminator": [
        104,
        72,
        168,
        177,
        241,
        79,
        231,
        167
      ]
    },
    {
      "name": "auctionFilled",
      "discriminator": [
        179,
        194,
        228,
        99,
        108,
        245,
        165,
        110
      ]
    },
    {
      "name": "auctionStarted",
      "discriminator": [
        126,
        97,
        193,
        56,
        72,
        162,
        162,
        64
      ]
    },
    {
      "name": "feesAccrued",
      "discriminator": [
        1,
        151,
        46,
        93,
        244,
        90,
        12,
        191
      ]
    },
    {
      "name": "fundInitialized",
      "discriminator": [
        253,
        64,
        136,
        81,
        179,
        19,
        1,
        155
      ]
    },
    {
      "name": "mintFinalized",
      "discriminator": [
        201,
        211,
        37,
        248,
        157,
        98,
        73,
        211
      ]
    },
    {
      "name": "redeemBegun",
      "discriminator": [
        37,
        100,
        181,
        169,
        6,
        217,
        197,
        127
      ]
    },
    {
      "name": "refPriceSet",
      "discriminator": [
        9,
        173,
        35,
        192,
        24,
        31,
        9,
        117
      ]
    },
    {
      "name": "tokenMetadataSet",
      "discriminator": [
        203,
        73,
        184,
        127,
        183,
        146,
        2,
        247
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Operation is paused"
    },
    {
      "code": 6001,
      "name": "auctionsOpen",
      "msg": "Cannot begin mint while auctions are open"
    },
    {
      "code": 6002,
      "name": "staleEpoch",
      "msg": "Fund epoch changed since session began"
    },
    {
      "code": 6003,
      "name": "incompleteDeposits",
      "msg": "Not every active slot has been deposited"
    },
    {
      "code": 6004,
      "name": "incompleteWithdrawals",
      "msg": "Not every entitled slot has been withdrawn"
    },
    {
      "code": 6005,
      "name": "wrongRemainingAccounts",
      "msg": "Remaining accounts do not match the fund's active slots"
    },
    {
      "code": 6006,
      "name": "slotNotActive",
      "msg": "Slot is not active"
    },
    {
      "code": 6007,
      "name": "alreadyDeposited",
      "msg": "Slot already deposited"
    },
    {
      "code": 6008,
      "name": "auctionNotOpen",
      "msg": "Auction is not open"
    },
    {
      "code": 6009,
      "name": "auctionEnded",
      "msg": "Auction has ended"
    },
    {
      "code": 6010,
      "name": "auctionNotEnded",
      "msg": "Auction has not ended"
    },
    {
      "code": 6011,
      "name": "exceedsRemaining",
      "msg": "Amount exceeds remaining"
    },
    {
      "code": 6012,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6013,
      "name": "supplyZero",
      "msg": "Index supply is zero"
    },
    {
      "code": 6014,
      "name": "supplyNotZero",
      "msg": "Index supply must be zero"
    },
    {
      "code": 6015,
      "name": "maxAssets",
      "msg": "Maximum number of assets reached"
    },
    {
      "code": 6016,
      "name": "assetNotEmpty",
      "msg": "Asset vault is not empty or has pending balances"
    },
    {
      "code": 6017,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6018,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6019,
      "name": "invalidMint",
      "msg": "Invalid mint"
    },
    {
      "code": 6020,
      "name": "invalidArgument",
      "msg": "Invalid argument"
    },
    {
      "code": 6021,
      "name": "emptyVault",
      "msg": "Vault is empty"
    },
    {
      "code": 6022,
      "name": "insufficientBalance",
      "msg": "Insufficient effective vault balance"
    },
    {
      "code": 6023,
      "name": "alreadyWithdrawn",
      "msg": "Slot already withdrawn"
    },
    {
      "code": 6024,
      "name": "wrongAssetStatus",
      "msg": "Asset is not in the expected status"
    },
    {
      "code": 6025,
      "name": "sessionNotReady",
      "msg": "Session is not ready (begin chunks incomplete)"
    },
    {
      "code": 6026,
      "name": "sessionAlreadyReady",
      "msg": "Session is already ready"
    },
    {
      "code": 6027,
      "name": "refPriceUnset",
      "msg": "Reference price not set for an auction asset"
    },
    {
      "code": 6028,
      "name": "refPriceMoveTooLarge",
      "msg": "Reference price move exceeds max_ref_move_bps for this period"
    },
    {
      "code": 6029,
      "name": "priceBelowBound",
      "msg": "Auction end price is below the reference-price bound"
    },
    {
      "code": 6030,
      "name": "timelockRequired",
      "msg": "Timelock is enabled; queue this change with queue_action"
    },
    {
      "code": 6031,
      "name": "timelockNotElapsed",
      "msg": "Pending action eta has not elapsed"
    },
    {
      "code": 6032,
      "name": "invalidActionKind",
      "msg": "Unknown pending action kind"
    },
    {
      "code": 6033,
      "name": "wrongActionKind",
      "msg": "Pending action kind does not match this instruction"
    },
    {
      "code": 6034,
      "name": "wrongActionTarget",
      "msg": "Account does not match the pending action payload"
    },
    {
      "code": 6035,
      "name": "shortDeposit",
      "msg": "Vault received less than the required deposit (transfer fee?); send a larger gross_amount"
    },
    {
      "code": 6036,
      "name": "shortFill",
      "msg": "Buy vault received less than the auction price (transfer fee?); send a larger gross_buy_amount"
    }
  ],
  "types": [
    {
      "name": "actionCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "actionExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "executor",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "actionQueued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "key",
            "type": "pubkey"
          },
          {
            "name": "values",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "etaSlot",
            "type": "u64"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "asset",
      "docs": [
        "A constituent. PDA: [\"asset\", fund, mint]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "ATA(fund PDA, mint)"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "index",
            "docs": [
              "slot 0..511"
            ],
            "type": "u16"
          },
          {
            "name": "status",
            "docs": [
              "0 = Active, 1 = Removing"
            ],
            "type": "u8"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "targetWeightBps",
            "type": "u16"
          },
          {
            "name": "pendingDeposits",
            "docs": [
              "tokens sitting in vault from unfinalized mint sessions (excluded from NAV).",
              "Credited with the amount the vault actually received (balance delta), so it can never",
              "exceed `vault.amount` even for Token-2022 fee-on-transfer mints."
            ],
            "type": "u64"
          },
          {
            "name": "pendingWithdrawals",
            "docs": [
              "tokens reserved by open redeem sessions (excluded from NAV)"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump, lets begin_mint/redeem verify Asset PDAs with create_program_address"
            ],
            "type": "u8"
          },
          {
            "name": "refPrice",
            "docs": [
              "Reference price, Q64.64, fund numeraire per raw base unit of the token",
              "(off-chain convention: numeraire = 1e-9 USD). 0 = unset (auctions on this asset are blocked)."
            ],
            "type": "u128"
          },
          {
            "name": "refPriceUpdatedSlot",
            "type": "u64"
          },
          {
            "name": "refPriceAnchor",
            "docs": [
              "ref_price at the start of the current move window; the move cap is measured against it."
            ],
            "type": "u128"
          },
          {
            "name": "refPriceAnchorSlot",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "assetAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "targetWeightBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "assetRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "auction",
      "docs": [
        "Dutch auction. PDA: [\"auction\", fund, auction_nonce_le]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "sellAsset",
            "docs": [
              "Asset PDA being sold from vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "buyAsset",
            "docs": [
              "Asset PDA being bought into vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "sellRemaining",
            "type": "u64"
          },
          {
            "name": "sellTotal",
            "type": "u64"
          },
          {
            "name": "startPrice",
            "docs": [
              "buy_token per sell_token, Q64.64 — decays linearly to end_price"
            ],
            "type": "u128"
          },
          {
            "name": "endPrice",
            "type": "u128"
          },
          {
            "name": "startSlot",
            "type": "u64"
          },
          {
            "name": "endSlot",
            "type": "u64"
          },
          {
            "name": "boughtTotal",
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "0 open, 1 filled, 2 cancelled, 3 expired"
            ],
            "type": "u8"
          },
          {
            "name": "nonce",
            "docs": [
              "fund.auction_nonce at creation (seed). Appended to the spec layout."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auctionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "auctionFilled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "filler",
            "type": "pubkey"
          },
          {
            "name": "sellAmount",
            "type": "u64"
          },
          {
            "name": "buyAmount",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u128"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "auctionStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "sellAsset",
            "type": "pubkey"
          },
          {
            "name": "buyAsset",
            "type": "pubkey"
          },
          {
            "name": "sellTotal",
            "type": "u64"
          },
          {
            "name": "startPrice",
            "type": "u128"
          },
          {
            "name": "endPrice",
            "type": "u128"
          },
          {
            "name": "startSlot",
            "type": "u64"
          },
          {
            "name": "endSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feesAccrued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "fund",
      "docs": [
        "The fund. PDA: [\"fund\", index_mint]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pendingAuthority",
            "type": "pubkey"
          },
          {
            "name": "rebalancer",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "indexMint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "assetCount",
            "type": "u16"
          },
          {
            "name": "activeBitmap",
            "docs": [
              "bit i set if asset slot i is Active (participates in mint/redeem)."
            ],
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "mintFeeBps",
            "type": "u16"
          },
          {
            "name": "redeemFeeBps",
            "type": "u16"
          },
          {
            "name": "mgmtFeeBps",
            "type": "u16"
          },
          {
            "name": "lastFeeAccrualTs",
            "type": "i64"
          },
          {
            "name": "epoch",
            "docs": [
              "Increments on every auction fill; invalidates open mint sessions."
            ],
            "type": "u64"
          },
          {
            "name": "openAuctions",
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "bit0 = mint paused, bit1 = redeem paused, bit2 = auctions paused."
            ],
            "type": "u8"
          },
          {
            "name": "auctionNonce",
            "type": "u64"
          },
          {
            "name": "occupiedBitmap",
            "docs": [
              "bit i set if asset slot i is occupied by an Asset account (Active or Removing)."
            ],
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "maxAuctionDiscountBps",
            "docs": [
              "Auction `end_price` may not be more than this far below the ref-price fair value."
            ],
            "type": "u16"
          },
          {
            "name": "maxRefMoveBps",
            "docs": [
              "Rebalancer ref-price updates may move at most this far from the period anchor."
            ],
            "type": "u16"
          },
          {
            "name": "refMovePeriodSlots",
            "docs": [
              "Length of the ref-price move window in slots."
            ],
            "type": "u64"
          },
          {
            "name": "timelockSlots",
            "docs": [
              "Admin timelock in slots (0 = direct admin ixs allowed; localnet/tests)."
            ],
            "type": "u64"
          },
          {
            "name": "actionNonce",
            "docs": [
              "Next PendingAction nonce."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "fundInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "indexMint",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "mintFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "mintSession",
      "docs": [
        "In-kind creation session. PDA: [\"mint_session\", fund, owner, nonce_le].",
        "Zero-copy (4.2 KB): `required` has one u64 per slot."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "units",
            "docs": [
              "index units requested (gross, before fee)"
            ],
            "type": "u64"
          },
          {
            "name": "epoch",
            "docs": [
              "fund.epoch at begin; finalize requires equality"
            ],
            "type": "u64"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "nextSlot",
            "docs": [
              "Chunked begin: the next active slot to compute `required` for. Slots below are done."
            ],
            "type": "u16"
          },
          {
            "name": "ready",
            "docs": [
              "1 once every active slot has been computed (gates deposit / finalize)."
            ],
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "depositedBitmap",
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "required",
            "docs": [
              "per-slot required deposit, computed at begin (possibly over several chunks).",
              "`deposit` overwrites the slot with the amount the vault actually received (>= required),",
              "which is what `finalize_mint` / `cancel_mint_refund` release from `pending_deposits`."
            ],
            "type": {
              "array": [
                "u64",
                512
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pendingAction",
      "docs": [
        "Timelocked admin action. PDA: [\"pending\", fund, nonce_le]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "queuedSlot",
            "type": "u64"
          },
          {
            "name": "etaSlot",
            "type": "u64"
          },
          {
            "name": "key",
            "docs": [
              "Pubkey payload (asset mint / new rebalancer / new fee recipient), kind-dependent."
            ],
            "type": "pubkey"
          },
          {
            "name": "values",
            "docs": [
              "Numeric payload, kind-dependent (see ACTION_* docs)."
            ],
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "redeemBegun",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "redeemSession",
      "docs": [
        "In-kind redemption session. PDA: [\"redeem_session\", fund, owner, nonce_le]."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "units",
            "docs": [
              "net units burned"
            ],
            "type": "u64"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "nextSlot",
            "type": "u16"
          },
          {
            "name": "ready",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "withdrawnBitmap",
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "entitled",
            "docs": [
              "per-slot amount owed, computed & reserved at begin (possibly over several chunks)"
            ],
            "type": {
              "array": [
                "u64",
                512
              ]
            }
          }
        ]
      }
    },
    {
      "name": "refPriceSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "oldPrice",
            "type": "u128"
          },
          {
            "name": "newPrice",
            "type": "u128"
          },
          {
            "name": "signer",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenMetadataSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fund",
            "type": "pubkey"
          },
          {
            "name": "indexMint",
            "type": "pubkey"
          },
          {
            "name": "metadata",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "created",
            "docs": [
              "true when the metadata account was created, false when it was updated."
            ],
            "type": "bool"
          }
        ]
      }
    }
  ]
};
