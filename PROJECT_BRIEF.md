# CertiChain — Project/Innovation Brief

## Problem
Paper certificates and ordinary PDFs can be forged or altered. Employers and institutions often need to contact the issuing institution to confirm authenticity.

## Proposed solution
CertiChain creates a cryptographic fingerprint for every certificate, anchors that fingerprint in a Solidity smart contract on an Ethereum-compatible ledger, and provides QR-based public verification. Certificate metadata is stored off-chain so the blockchain does not expose the student's personal information.

## Core innovation
The innovation is not blockchain alone. It is the combination of:
1. Hash-based tamper evidence
2. Blockchain anchoring
3. QR-based one-step verification
4. Revocation lifecycle
5. Audit trail
6. A demo-friendly issuer/verifier workflow

## Threat model
If a certificate field changes, the canonical data changes, the SHA-256 digest changes, and the blockchain comparison fails. If the original certificate is revoked, verification fails even when the data itself is unchanged.

## Limitations
This prototype uses a local blockchain and a demo private key. Production deployment needs secure key management, institution authentication, governance, privacy controls, rate limiting, a production network, and interoperability standards such as W3C Verifiable Credentials.

## Existing related systems
Blockcerts is an open standard for issuing and verifying blockchain credentials. OpenCerts, developed through Singapore's Smart Nation ecosystem, provides blockchain-backed academic certificate verification. These establish that the general concept is already known; therefore a hackathon submission should not claim blockchain certificate verification itself as a new invention.

## Suggested unique positioning
"An end-to-end certificate fraud-prevention demonstrator that makes the verification decision explainable: database hash check + blockchain hash check + revocation check, with a QR-first employer workflow and an auditable verification trail."

## Suggested future work
- W3C Verifiable Credentials
- Decentralized Identifiers (DIDs)
- Selective disclosure
- Institution/issuer role management
- Student wallet
- Employer API
- IPFS or institutional document storage
- Multi-institution federation
- Analytics for suspicious verification patterns
