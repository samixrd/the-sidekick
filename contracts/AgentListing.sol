// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * THE SIDEKICK — AgentListing registry.
 *
 * Stores a marketplace listing for an ERC-8004 agent identity. The listing is
 * bond-backed: the first time an agent is listed, the caller MUST send a
 * minimum BNB stake (the bond). The bond is an explicit, signed transaction —
 * there is NO path for an agent to autonomously trigger this spend without the
 * owner's signature on that specific tx (the value is carried in msg.value and
 * can only be set by a signed call).
 *
 * KEY DESIGN: listAgent() is callable by ANY wallet (human owner's EOA or an
 * agent's own wallet) via the EXACT SAME function — no caller special-casing.
 *
 * After the initial listing, the lister can update metadata (category
 * description / metadataURI) WITHOUT further bond, autonomously — via
 * updateAgentMetadata(), which requires NO value.
 */

/// @title AgentListing
/// @notice Bond-backed on-chain registry of sidekick agent listings.
contract AgentListing {
    // ── Category whitelist ──
    enum Category { Rebalancing, GridTrading, Yield, HealthFactor }

    // ── Listing record ──
    struct Listing {
        uint256 erc8004TokenId;   // ERC-8004 identity tokenId
        address lister;           // who called listAgent (owner's EOA or agent wallet)
        address agentWallet;      // pulled from the listing (often == lister, may differ)
        Category category;
        string metadataURI;       // IPFS/https/data URI for category-specific metadata
        uint256 bond;             // BNB bond paid (wei)
        uint256 listedAt;         // block timestamp
        uint64 updateCount;       // how many autonomous metadata updates happened
    }

    uint256 public immutable MIN_BOND;          // wei — minimum stake to list
    address public immutable identityRegistry;  // ERC-8004 IdentityRegistry (for sanity only)

    mapping(uint256 => Listing) public listings;      // erc8004TokenId => Listing
    mapping(uint256 => bool) public isListed;          // fast existence check
    uint256[] public listedTokens;                     // insertion-ordered, for enumeration

    event AgentListed(
        uint256 indexed erc8004TokenId,
        address indexed lister,
        address agentWallet,
        Category category,
        string metadataURI,
        uint256 bond,
        uint256 listedAt
    );
    event AgentMetadataUpdated(
        uint256 indexed erc8004TokenId,
        address indexed updater,
        string metadataURI,
        uint64 updateCount
    );

    error AlreadyListed(uint256 erc8004TokenId);
    error NotListed(uint256 erc8004TokenId);
    error NotLister(address caller);
    error BondTooLow(uint256 sent, uint256 required);
    error InvalidCategory();

    constructor(uint256 _minBond, address _identityRegistry) {
        require(_minBond > 0, "min bond must be > 0");
        MIN_BOND = _minBond;
        identityRegistry = _identityRegistry;
    }

    /**
     * @notice List an ERC-8004 agent. Callable by ANY wallet (human or agent).
     * @dev The bond (msg.value) MUST be >= MIN_BOND. First-time listing only —
     *      after this, use updateAgentMetadata() (no bond, autonomous).
     *      The bond is intentionally NOT refundable to keep the gate honest.
     *      No autonomous path exists: this spend can only fire via a signed tx
     *      that carries the value.
     */
    function listAgent(
        uint256 erc8004TokenId,
        Category category,
        string calldata metadataURI,
        address agentWallet
    ) external payable returns (uint256 bond) {
        if (isListed[erc8004TokenId]) revert AlreadyListed(erc8004TokenId);
        if (msg.value < MIN_BOND) revert BondTooLow(msg.value, MIN_BOND);
        if (uint8(category) > 3) revert InvalidCategory();

        isListed[erc8004TokenId] = true;
        listings[erc8004TokenId] = Listing({
            erc8004TokenId: erc8004TokenId,
            lister: msg.sender,
            agentWallet: agentWallet,
            category: category,
            metadataURI: metadataURI,
            bond: msg.value,
            listedAt: block.timestamp,
            updateCount: 0
        });
        listedTokens.push(erc8004TokenId);

        emit AgentListed(erc8004TokenId, msg.sender, agentWallet, category, metadataURI, msg.value, block.timestamp);
        return msg.value;
    }

    /**
     * @notice Update listing metadata (category description / metadataURI).
     * @dev Callable autonomously by the lister WITHOUT re-confirmation or bond.
     *      Does NOT touch the bond. This is the post-initial-listing path.
     */
    function updateAgentMetadata(uint256 erc8004TokenId, string calldata newMetadataURI) external {
        Listing storage _l = listings[erc8004TokenId];
        if (!isListed[erc8004TokenId]) revert NotListed(erc8004TokenId);
        if (_l.lister != msg.sender) revert NotLister(msg.sender);
        _l.metadataURI = newMetadataURI;
        _l.updateCount += 1;
        emit AgentMetadataUpdated(erc8004TokenId, msg.sender, newMetadataURI, _l.updateCount);
    }

    /// @notice Read a listing.
    function getListing(uint256 erc8004TokenId) external view returns (Listing memory) {
        return listings[erc8004TokenId];
    }

    /// @notice Whether a tokenId has an active listing.
    function isAgentListed(uint256 erc8004TokenId) external view returns (bool) {
        return isListed[erc8004TokenId];
    }

    /// @notice Number of listed agents.
    function listedCount() external view returns (uint256) {
        return listedTokens.length;
    }

    /// @notice List a tokenId by index (for enumeration).
    function listedTokenAt(uint256 index) external view returns (uint256) {
        return listedTokens[index];
    }
}
