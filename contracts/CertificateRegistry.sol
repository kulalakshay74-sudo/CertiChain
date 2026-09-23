// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CertificateRegistry {
    struct Certificate {
        bytes32 documentHash;
        address issuer;
        uint256 issuedAt;
        bool revoked;
        string certificateId;
    }

    mapping(string => Certificate) private certificates;
    mapping(bytes32 => string) private hashToId;

    event CertificateIssued(
        string indexed certificateId,
        bytes32 indexed documentHash,
        address indexed issuer,
        uint256 issuedAt
    );

    event CertificateRevoked(
        string indexed certificateId,
        address indexed issuer,
        uint256 revokedAt
    );

    function issueCertificate(
        string calldata certificateId,
        bytes32 documentHash
    ) external {
        require(bytes(certificateId).length > 0, "Certificate ID required");
        require(certificates[certificateId].issuedAt == 0, "Certificate already exists");
        require(bytes(hashToId[documentHash]).length == 0, "Hash already registered");

        certificates[certificateId] = Certificate({
            documentHash: documentHash,
            issuer: msg.sender,
            issuedAt: block.timestamp,
            revoked: false,
            certificateId: certificateId
        });

        hashToId[documentHash] = certificateId;
        emit CertificateIssued(certificateId, documentHash, msg.sender, block.timestamp);
    }

    function revokeCertificate(string calldata certificateId) external {
        Certificate storage c = certificates[certificateId];
        require(c.issuedAt != 0, "Certificate not found");
        require(c.issuer == msg.sender, "Only issuer can revoke");
        require(!c.revoked, "Already revoked");

        c.revoked = true;
        emit CertificateRevoked(certificateId, msg.sender, block.timestamp);
    }

    function getCertificate(string calldata certificateId)
        external
        view
        returns (
            bytes32 documentHash,
            address issuer,
            uint256 issuedAt,
            bool revoked
        )
    {
        Certificate memory c = certificates[certificateId];
        require(c.issuedAt != 0, "Certificate not found");
        return (c.documentHash, c.issuer, c.issuedAt, c.revoked);
    }

    function exists(string calldata certificateId) external view returns (bool) {
        return certificates[certificateId].issuedAt != 0;
    }
}