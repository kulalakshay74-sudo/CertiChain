const { spawn, execFileSync } = require('child_process');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { ethers } = require('ethers');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HARDHAT_CLI = path.join(PROJECT_ROOT, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');
let hardhatProcess = null;
let serverProcess = null;

const DEFAULT_LOCAL_ISSUER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function loadDotEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('='); if (idx < 1) continue;
    const key = line.slice(0, idx).trim(); let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

function waitForPort(host, port, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const socket = new net.Socket(); socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('timeout', () => { socket.destroy(); retry(); });
      socket.once('error', () => { socket.destroy(); retry(); });
      socket.connect(port, host);
    };
    const retry = () => Date.now() - started >= timeout ? reject(new Error(`Timed out waiting for ${host}:${port}`)) : setTimeout(check, 400);
    check();
  });
}

async function deployDirectly() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
  const signer = await provider.getSigner(0);
  const artifact = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'artifacts', 'contracts', 'CertificateRegistry.sol', 'CertificateRegistry.json'), 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const network = await provider.getNetwork();
  fs.writeFileSync(path.join(PROJECT_ROOT, 'deployment.json'), JSON.stringify({ address, abi: artifact.abi, network: 'localhost', chainId: Number(network.chainId), deployedAt: new Date().toISOString() }, null, 2));
  console.log(`CertificateRegistry deployed at ${address}`);
}

function shutdown() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (hardhatProcess && !hardhatProcess.killed) hardhatProcess.kill();
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

async function main() {
  try {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      throw new Error('Create .env from .env.example and set ADMIN_EMAIL and ADMIN_PASSWORD before running npm run dev.');
    }
    process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
    process.env.ISSUER_PRIVATE_KEY ||= DEFAULT_LOCAL_ISSUER_PRIVATE_KEY;
    console.log('Starting local Ethereum blockchain...');
    hardhatProcess = spawn(process.execPath, [HARDHAT_CLI, 'node', '--hostname', '127.0.0.1'], { cwd: PROJECT_ROOT, stdio: 'inherit', env: { ...process.env, HARDHAT_DISABLE_TELEMETRY: 'true' } });
    hardhatProcess.on('error', err => console.error('Hardhat process error:', err.message));
    await waitForPort('127.0.0.1', 8545);
    console.log('Blockchain is ready.');
    console.log('Compiling smart contract...');
    execFileSync(process.execPath, [HARDHAT_CLI, 'compile'], { cwd: PROJECT_ROOT, stdio: 'inherit', env: { ...process.env, HARDHAT_DISABLE_TELEMETRY: 'true' } });
    console.log('Deploying smart contract without a second Hardhat process...');
    await deployDirectly();
    console.log('Starting CertiChain server...');
    serverProcess = spawn(process.execPath, ['server.js'], { cwd: PROJECT_ROOT, stdio: 'inherit', env: { ...process.env, SESSION_SECRET: process.env.SESSION_SECRET } });
    serverProcess.on('error', err => console.error('Server process error:', err.message));
  } catch (error) {
    console.error('\nStartup failed:', error.message);
    shutdown();
    process.exitCode = 1;
  }
}
main();
