// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title BurnVault — the locked $RESETS burn reserve
/// @notice Tokens sent here can leave in exactly one direction: to the dead address.
///         No owner, no withdraw, no upgrade. The `burner` (the site's automation wallet) may
///         trigger fixed-size burns, once per reset event id and once per goal round, and nothing
///         else. Anyone can verify every outgoing transfer on the explorer goes to 0x…dEaD.
contract BurnVault {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    address public immutable burner;
    uint256 public immutable resetBurnAmount; // per published Claude reset
    uint256 public immutable roundBurnAmount; // per paid community-goal round

    mapping(bytes32 => bool) public resetBurned; // keccak256(eventId)
    mapping(uint256 => bool) public roundBurned;
    uint256 public totalBurned;

    event ResetBurn(string eventId, uint256 amount);
    event RoundBurn(uint256 indexed roundId, uint256 amount);

    constructor(address token_, address burner_, uint256 resetBurnAmount_, uint256 roundBurnAmount_) {
        require(token_ != address(0) && burner_ != address(0), "zero");
        token = IERC20(token_);
        burner = burner_;
        resetBurnAmount = resetBurnAmount_;
        roundBurnAmount = roundBurnAmount_;
    }

    modifier onlyBurner() {
        require(msg.sender == burner, "not burner");
        _;
    }

    /// @notice Reserve still waiting to be burned.
    function reserve() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Burn the fixed amount for a published Claude reset. Once per event id.
    function burnForReset(string calldata eventId) external onlyBurner {
        bytes32 key = keccak256(bytes(eventId));
        require(!resetBurned[key], "already burned");
        resetBurned[key] = true;
        uint256 amount = _burn(resetBurnAmount);
        emit ResetBurn(eventId, amount);
    }

    /// @notice Burn the fixed amount for a paid community-goal round. Once per round.
    function burnForRound(uint256 roundId) external onlyBurner {
        require(!roundBurned[roundId], "already burned");
        roundBurned[roundId] = true;
        uint256 amount = _burn(roundBurnAmount);
        emit RoundBurn(roundId, amount);
    }

    function _burn(uint256 wanted) internal returns (uint256 amount) {
        uint256 bal = token.balanceOf(address(this));
        amount = wanted > bal ? bal : wanted;
        require(amount > 0, "reserve empty");
        totalBurned += amount;
        require(token.transfer(DEAD, amount), "transfer failed");
    }
}
