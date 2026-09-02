// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * GUARD ROUTER — a thin proxy between a hired agent's session-key permissions
 * and PancakeSwap V2's router.
 *
 * PURPOSE
 *   The agent's session-key allowlist points at THIS contract, never at
 *   PancakeSwap's router directly. Every swap is gated by the per-hire policy:
 *     1. target token ∈ hire's approved scope        (set at hire time)
 *     2. live pool liquidity ≥ hire's minimum        (read from factory/pair)
 *   If both pass, the call is forwarded to the real router. If either fails,
 *   the WHOLE tx reverts (no partial execution, no partial state).
 *
 * POLICY (configurable per hire, never hardcoded)
 *   - approved tokens:      address[] (keccak scoped by hireId) — set at hire
 *   - minLiquidity:         uint256 (token units) — set at hire
 *   - sessionKey:           address allowed to act for this hire (the agent)
 *   - owner:                address that created the hire (can adjust policy)
 *
 * ARCHITECTURE
 *   - Real router/factory are immutable at deploy time (verified on BSC testnet).
 *   - Reentrancy guard prevents the router's intermediate callback to msg.sender
 *     (or the target token's transfer) from re-entering as the session key.
 */
interface IRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IPair {
    function getReserves() external view returns (uint112 r0, uint112 r1, uint32 blockTimestampLast);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

contract GuardRouter {
    address public immutable ROUTER;
    address public immutable FACTORY;

    uint256 private _locked = 1;
    modifier noReentrancy() {
        require(_locked == 1, "locked");
        _locked = 2;
        _;
        _locked = 1;
    }

    struct Hire {
        address owner;        // who created/adjusts the hire
        address sessionKey;   // agent wallet allowed to act
        uint256 minLiquidity; // min total pool liquidity across the path (token units)
        bool active;
    }

    mapping(bytes32 => Hire) public hires;
    mapping(bytes32 => mapping(address => bool)) public approvedTokens;

    modifier onlyHireOwner(bytes32 hireId) {
        require(msg.sender == hires[hireId].owner, "not owner");
        _;
    }

    event HireCreated(bytes32 indexed hireId, address indexed owner, address sessionKey, uint256 minLiquidity);
    event HireUpdated(bytes32 indexed hireId, address sessionKey, uint256 minLiquidity);
    event SwapForwarded(bytes32 indexed hireId, address indexed caller, address[] path, uint256 amountIn, uint256 amountOut);
    event SwapRejected(bytes32 indexed hireId, address indexed caller, address[] path, string reason);

    constructor(address _router, address _factory) {
        require(_router != address(0) && _factory != address(0), "bad addr");
        ROUTER = _router;
        FACTORY = _factory;
    }

    // ── per-hire policy ─────────────────────────────────────────────

    function createHire(bytes32 hireId, address sessionKey, address[] calldata tokens, uint256 _minLiquidity) external {
        require(hires[hireId].sessionKey == address(0), "exists");
        require(sessionKey != address(0), "bad key");
        Hire storage h = hires[hireId];
        h.owner = msg.sender;
        h.sessionKey = sessionKey;
        h.minLiquidity = _minLiquidity;
        h.active = true;
        _setTokens(hireId, tokens);
        emit HireCreated(hireId, msg.sender, sessionKey, _minLiquidity);
    }

    function updateHire(bytes32 hireId, address sessionKey, address[] calldata tokens, uint256 _minLiquidity)
        external
        onlyHireOwner(hireId)
    {
        Hire storage h = hires[hireId];
        h.sessionKey = sessionKey;
        h.minLiquidity = _minLiquidity;
        // Replace the whole token scope: clear existing, then set new.
        _clearTokens(hireId);
        _setTokens(hireId, tokens);
        emit HireUpdated(hireId, sessionKey, _minLiquidity);
    }

    function setActive(bytes32 hireId, bool active) external onlyHireOwner(hireId) {
        hires[hireId].active = active;
    }

    // ── guarded swap ────────────────────────────────────────────────

    function swapExactTokensForTokensGuarded(
        bytes32 hireId,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external noReentrancy returns (uint256[] memory) {
        Hire storage h = hires[hireId];
        require(h.active, "hire inactive");
        require(msg.sender == h.sessionKey, "not session key");
        require(path.length >= 2, "bad path");

        // 1) target token = LAST element of path (what the agent buys).
        address target = path[path.length - 1];
        require(approvedTokens[hireId][target], "target not in scope");

        // 2) live liquidity across path; must be >= min (else whole tx reverts).
        require(_pathLiquidity(path) >= h.minLiquidity, "insufficient liquidity");

        // 3) pull input from the session key (agent approved this contract),
        //    forward to the real router, deliver output to `to`.
        address tokenIn = path[0];
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "pull failed");
        require(IERC20(tokenIn).approve(ROUTER, amountIn), "approve failed");

        (uint256 amountOut, uint256[] memory amounts) = _forwardSwap(amountIn, amountOutMin, path, to, deadline);

        // sweep any unused input back to the session key (so agent isn't stuck)
        uint256 leftoverInput = IERC20(tokenIn).balanceOf(address(this));
        if (leftoverInput > 0) {
            IERC20(tokenIn).transfer(msg.sender, leftoverInput);
        }
        // sweep any dust output that landed on this contract (should be 0)
        uint256 dustOut = IERC20(target).balanceOf(address(this));
        if (dustOut > 0) {
            IERC20(target).transfer(to, dustOut);
        }

        emit SwapForwarded(hireId, msg.sender, path, amountIn, amountOut);
        return amounts;
    }

    // sum of pool liquidity across every hop in the path
    function _pathLiquidity(address[] calldata path) internal view returns (uint256) {
        uint256 total;
        for (uint256 i = 0; i + 1 < path.length; i++) {
            total += _pairLiquidity(path[i], path[i + 1]);
        }
        return total;
    }

    // forward the swap and compute the realized out amount
    function _forwardSwap(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        internal
        returns (uint256 amountOut, uint256[] memory amounts)
    {
        address target = path[path.length - 1];
        uint256 balanceBefore = IERC20(target).balanceOf(to);
        amounts = IRouter(ROUTER).swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline);
        uint256 balanceAfter = IERC20(target).balanceOf(to);
        amountOut = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : (amounts.length > 0 ? amounts[amounts.length - 1] : 0);
    }

    // helper: total liquidity (reserve0 + reserve1) of a pair
    function _pairLiquidity(address tokenA, address tokenB) internal view returns (uint256) {
        address pair = IFactory(FACTORY).getPair(tokenA, tokenB);
        if (pair == address(0)) return 0;
        (uint112 r0, uint112 r1, ) = IPair(pair).getReserves();
        return uint256(r0) + uint256(r1);
    }

    function _setTokens(bytes32 hireId, address[] calldata tokens) internal {
        address[] storage list = _hireTokens[hireId];
        for (uint256 i = 0; i < tokens.length; i++) {
            approvedTokens[hireId][tokens[i]] = true;
            list.push(tokens[i]);
        }
    }

    function _clearTokens(bytes32 hireId) internal {
        // We don't have a reverse enumeration, so clearing is done by the owner
        // via explicit token list; a bounded approach is used in tests. To keep
        // it fully general we iterate a stored list.
        address[] storage list = _hireTokens[hireId];
        for (uint256 i = 0; i < list.length; i++) {
            approvedTokens[hireId][list[i]] = false;
        }
        delete _hireTokens[hireId];
    }

    mapping(bytes32 => address[]) private _hireTokens;

    receive() external payable {}
}
