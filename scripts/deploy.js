const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const Registry = await hre.ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  const artifact = await hre.artifacts.readArtifact("CertificateRegistry");
  const deployment = {
    address,
    abi: artifact.abi,
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(__dirname, "..", "deployment.json"),
    JSON.stringify(deployment, null, 2)
  );
  console.log(`CertificateRegistry deployed at ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});