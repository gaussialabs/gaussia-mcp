# Gaussia blind-matching commitment (draft v0)

Status: draft. Gaussia's node network, job coordinator and contracts are not deployed yet (see the whitepaper). This document fixes the commitment format so that every implementation computes the same bytes. The sibling repo [`gaussia-match`](https://github.com/gaussialabs/gaussia-match) implements the same commitment (`commitHash`, plus a Solidity reference library); both vectors in `vectors/commitment.json` give identical results there (checked 2026-11-27).

## 1. Why

Each job goes to two random nodes. A node first publishes a commitment to its result, and reveals the result only after the other node has committed too, so neither can copy the other.

## 2. Commitment

```
commitment = keccak256(abi.encode(bytes32 jobId, bytes32 resultHash, address wallet, bytes32 salt))
```

- `abi.encode` is Solidity's standard (non-packed) ABI encoding: four 32-byte words, 128 bytes. The address is left-padded with zeros.
- `jobId`: 32-byte job identifier assigned by the coordinator.
- `resultHash`: 32-byte hash of the node's result. How the result is serialized and hashed is defined by the node container, not here.
- `wallet`: the node's payout address. Binding it into the commitment stops another node from re-using someone else's commitment.
- `salt`: 32 random bytes chosen by the node and kept secret until the reveal. Without it, a result with few possible values could be guessed from the commitment.

Hex in and out is `0x`-prefixed. Implementations must reject a mixed-case address whose EIP-55 checksum is wrong.

## 3. Reveal check

A reveal `(jobId, resultHash, wallet, salt)` opens a commitment `c` if and only if the commitment computed from it equals `c`.

## 4. Matching

Among reveals that open their commitments, for the same `jobId`, counting each wallet once:

- `verified`: one `resultHash` is shared by at least two wallets and by more wallets than any other result. Wallets with a different result are outliers.
- `mismatch`: no result has a strict majority of at least two (for example two wallets with two different results). The whitepaper's rule: send the job to a third node.
- `incomplete`: fewer than two distinct wallets with valid reveals, or reveals for different jobs.

## 5. Test vectors

`vectors/commitment.json`. Both vectors were computed with viem and checked independently with Python `eth-abi` and `pycryptodome` keccak.

| | |
|---|---|
| jobId | `0x11…11` (32 bytes of 0x11) |
| resultHash | `0x22…22` |
| wallet | `0x3333333333333333333333333333333333333333` |
| salt | `0x44…44` |
| commitment | `0xe60df2107077d59eb706432a888b7ed8626a905471df0f245646ca6455d8b7e5` |
