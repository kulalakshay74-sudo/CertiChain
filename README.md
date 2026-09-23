# CertiChain 2.0

Blockchain-Based Digital Certificate Verification & Fraud Prevention System.

## Included workflow
- Admin authentication with credentials stored only in `.env`
- Student portal with a real password hash (passwords are never stored in plaintext)
- Generate certificate metadata + PDF + QR verification
- Upload an existing PDF/image and hash its exact bytes with SHA-256
- Anchor the hash on a local Ethereum/Hardhat blockchain
- Public certificate lookup and QR verification
- Exact-file verification for uploaded certificates
- Certificate revocation recorded on-chain
- Download / print certificates
- Optional SMTP email delivery
- Admin certificate registry and audit trail
- Windows-safe local startup that avoids the previous Hardhat child-process crash

## Run in Visual Studio / VS Code on Windows

### 1. Requirements
- Node.js 20 LTS or newer supported LTS release
- npm

### 2. Install dependencies
```powershell
npm install
```

### 3. Create local secrets
```powershell
Copy-Item .env.example .env
```

Edit `.env` and set:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (8+ characters)
- `SESSION_SECRET` (32+ random characters)
- `ISSUER_PRIVATE_KEY`

For local Hardhat, `ISSUER_PRIVATE_KEY` must be a private key belonging to the local Hardhat node. It is only for local development. Never put a real wallet key in `.env` for this project and never commit `.env`.

### 4. Start everything
```powershell
npm run dev
```

The script starts the local blockchain, compiles the contract, deploys a fresh `CertificateRegistry`, writes `deployment.json`, and starts the web server on:

`http://localhost:3000`

Stop it with `Ctrl+C`.

### 5. Test the workflow
1. Sign in as Admin using the credentials from `.env`.
2. **Issue Certificate**: enter student details and an 8+ character student portal password. The system anchors the certificate hash on-chain and creates a QR-enabled PDF.
3. **Certificates**: confirm the certificate, download the PDF, and inspect its transaction/hash.
4. **Verify Certificate**: enter the ID and verify it. For an uploaded certificate, also upload the original file to test exact SHA-256 matching.
5. **Student**: sign out, choose Student, and use the email/password configured during certificate issuance. Confirm the certificate appears and can be downloaded/printed.
6. **Revoke**: sign back in as Admin, revoke the certificate, then verify again. The result must be `REVOKED`.
7. **Audit Trail**: confirm issue, verification and revocation events are present.
8. **Upload Certificate**: create another certificate with the original PDF/image. Verify the same file as authentic, then change the file and verify again; the changed file must fail.
9. **Email**: configure SMTP in `.env` and use the Email action. Without SMTP configuration the UI reports a clear configuration error instead of silently failing.

## Security
- `.env` is ignored by Git and must never be committed.
- `.env.example` contains placeholders only.
- Admin and student passwords are hashed with `scrypt` and are not saved in plaintext.
- Session tokens are signed with `SESSION_SECRET` and expire after 8 hours.
- Uploaded certificate files are ignored by Git.
- The blockchain stores only the certificate fingerprint, not the PDF/image itself.
- The bundled local Hardhat account is for local development only. Never reuse a local test key on a real network.

## GitHub
After local testing, push the project to your GitHub repository. Do not push `.env`, `uploads/`, `node_modules/`, `artifacts/`, or real SMTP credentials.
