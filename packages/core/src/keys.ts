import { deriveConfidentialKeys } from '@solana-program/token-2022/confidential';
import type { Address, MessagePartialSigner } from '@solana/kit';
import { AeKey, ElGamalKeypair, ElGamalSecretKey } from '@solana/zk-sdk/bundler';

/** The encryption keys behind one wallet's confidential balances. */
export type ConfidentialKeys = {
  /** Decrypts incoming (pending) amounts and signs balance proofs. */
  elgamal: ElGamalKeypair;
  /** Decrypts the owner's own available balance. */
  ae: AeKey;
  /** The ElGamal public key, in the 32-byte address form Token-2022 stores. */
  elgamalPubkey: Address;
};

/**
 * Derives a wallet's confidential keys from one signature over the constant
 * `solana-conf-bal/v1` message. These are the same keys the spl-token CLI and other
 * standard clients derive for that wallet, so there is no extra secret to store:
 * the wallet can always re-derive them.
 *
 * The signer must produce deterministic Ed25519 signatures (keypair files and standard
 * wallets do), or the keys will change from one derivation to the next.
 */
export async function deriveKeys(signer: MessagePartialSigner): Promise<ConfidentialKeys> {
  const { elgamalKeypair, aeKey } = await deriveConfidentialKeys({ signer });
  return {
    elgamal: ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(elgamalKeypair.secretKey)),
    ae: AeKey.fromBytes(aeKey),
    elgamalPubkey: elgamalKeypair.elgamalPubkey,
  };
}
